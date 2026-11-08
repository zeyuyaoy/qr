import { effectiveExpiry, evaluateLink, isRetired } from "./expiry";
import { verifyPassword } from "./crypto";
import { env } from "./env";
import type { QrRecord, Settings } from "./schema";
import { RedisUnavailableError } from "./redis/client";
import { acceptScan, hit, recordExists, resolveSlug, visitorKey } from "./redis/repo";
import { DEFAULT_BRAND, PAGES, PAGE_HEADERS, gatePage } from "./public-pages";
import { appHost, checkDestination } from "./url-safety";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const REDIRECT_HEADERS = { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

const html = (body: string, status: number, extra: Record<string, string> = {}) => new Response(body, { status, headers: { ...PAGE_HEADERS, ...extra } });
const redirect = (to: string, status: 307 | 303) => new Response(null, { status, headers: { Location: to, ...REDIRECT_HEADERS } });

export function deviceCategory(ua: string | null): string {
  if (!ua) return "other";
  if (/bot|crawler|spider|preview|facebookexternalhit|slackbot|whatsapp|telegram/i.test(ua)) return "bot";
  if (/ipad|tablet|kindle|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "mobile";
  return "desktop";
}

const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

/**
 * Public redirect resolver.
 *  - GET: follows the link if allowed. An ACCEPTED SCAN is a request that passed state checks (and the
 *    password, if any) and, when a scan limit is set, atomically claimed one slot. Only accepted scans
 *    are counted; HEAD requests, password-gate renders, wrong passwords and every refusal are not.
 *  - Fails closed: if Redis is unreachable the visitor sees a 503 page, never a stale destination.
 *  - The destination comes only from the owner-written record; there is no URL parameter anywhere.
 */
export async function handleResolve(req: Request, slugRaw: string): Promise<Response> {
  const slug = slugRaw.toLowerCase();
  const method = req.method;
  let brand = DEFAULT_BRAND;
  try {
    if (!SLUG_RE.test(slug)) return html(PAGES.notFound(brand), 404);
    const found = await resolveSlug(slug);
    if (!found) {
      // A miss may mean "Redis was wiped", not "never existed": say so instead of a misleading 404.
      if (!(await recordExists())) return html(PAGES.unavailable(brand), 503, { "Retry-After": "300" });
      const n = await hit(`miss:${visitorKey(clientIp(req))}`, 600);
      if (n > 60) return html(PAGES.limited(brand), 429, { "Retry-After": "600" });
      return html(PAGES.notFound(brand), 404);
    }
    const { record, scans, settings } = found;
    brand = settings.brand;
    const state = evaluateLink(record, Date.now(), scans);

    if (state.kind !== "ok") return refusal(state, record, brand);

    // Defence in depth: re-validate the stored destination every time.
    const dest = checkDestination(record.payload, { appHost: appHost(env.appUrl()) });
    if (!dest.ok) return html(PAGES.badDestination(brand), 502);

    if (record.password) {
      if (method === "POST") return await handleGate(req, slug, record, settings, dest.url, brand);
      return html(gatePage(brand, slug), 200);
    }
    if (method === "HEAD") return redirect(dest.url, 307);
    if (method === "POST") return html(PAGES.notFound(brand), 405, { Allow: "GET, HEAD" });
    return await accept(req, record, settings, dest.url, brand, 307);
  } catch (e) {
    if (e instanceof RedisUnavailableError) return html(PAGES.unavailable(brand), 503, { "Retry-After": "30" });
    console.error("[resolve] unhandled", e instanceof Error ? e.name : typeof e);
    return html(PAGES.unavailable(brand), 503, { "Retry-After": "30" });
  }
}

function refusal(state: ReturnType<typeof evaluateLink>, record: { afterExpiry: { message: string | null; redirectUrl: string | null } }, brand: Settings["brand"]): Response {
  if (isRetired(state) && record.afterExpiry.redirectUrl) {
    const c = checkDestination(record.afterExpiry.redirectUrl, { appHost: appHost(env.appUrl()) });
    if (c.ok) return redirect(c.url, 307); // owner-configured replacement destination; not counted
  }
  switch (state.kind) {
    case "removed": return html(PAGES.removed(brand), 404);
    case "paused": return html(PAGES.paused(brand), 403);
    case "not_yet": return html(PAGES.notYet(brand, state.activateAt), 403);
    case "expired": return html(PAGES.expired(brand, record.afterExpiry.message), 410);
    case "exhausted": return html(PAGES.exhausted(brand, record.afterExpiry.message), 410);
    default: return html(PAGES.notFound(brand), 404);
  }
}

async function accept(
  req: Request,
  record: QrRecord,
  settings: Settings,
  dest: string,
  brand: Settings["brand"],
  status: 307 | 303,
): Promise<Response> {
  const track = settings.analytics.enabled && record.analytics;
  {
    const ua = settings.analytics.devices ? deviceCategory(req.headers.get("user-agent")) : "";
    const cc = req.headers.get("x-vercel-ip-country");
    const country = track && settings.analytics.geo && env.trustGeoHeaders() && cc && /^[A-Z]{2}$/.test(cc) ? cc : "";
    const expiresAt = effectiveExpiry(record);
    const n = await acceptScan({ id: record.id, limit: record.scanLimit, analytics: track, retentionDays: settings.analytics.retentionDays, device: track ? ua : "", country, expectedRev: record.rev, expiresAt });
    if (n === null) return refusal({ kind: "exhausted" }, record, brand); // lost the race for the last slot
  }
  return redirect(dest, status);
}

async function handleGate(
  req: Request,
  slug: string,
  record: QrRecord,
  settings: Settings,
  dest: string,
  brand: Settings["brand"],
): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(req.url).origin) return html(PAGES.notFound(brand), 403);
    } catch { return html(PAGES.notFound(brand), 403); }
  }
  const v = visitorKey(clientIp(req));
  // Brute-force limits: per visitor+link and per link overall. Checked BEFORE the expensive hash.
  const [perVisitor, perLink] = await Promise.all([hit(`pw:${slug}:${v}`, 600), hit(`pwl:${slug}`, 3600)]);
  if (perVisitor > 8 || perLink > 80) return html(PAGES.limited(brand), 429, { "Retry-After": "600" });
  let password = "";
  try {
    password = String((await req.formData()).get("password") ?? "");
  } catch {}
  if (!password || password.length > 128 || !record.password || !(await verifyPassword(password, record.password.hash))) {
    return html(gatePage(brand, slug, "Incorrect password."), 401); // not an accepted scan
  }
  return accept(req, record, settings, dest, brand, 303);
}
