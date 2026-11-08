import { auth } from "@/auth";
import { ApiError, toErrorResponse } from "./api";
import { env } from "./env";
import { hit } from "./redis/repo";

export type Owner = { email: string };

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF: SameSite=Lax cookies + required custom header + same-origin `Origin`. */
export function assertSameOrigin(req: Request) {
  if (SAFE.has(req.method)) return;
  if (req.headers.get("x-qr-csrf") !== "1") throw new ApiError("FORBIDDEN", "Missing CSRF header");
  const origin = req.headers.get("origin");
  if (origin) {
    const requestOrigin = new URL(req.url).origin;
    let ok = false;
    try {
      const o = new URL(origin);
      ok = o.origin === requestOrigin || o.origin === new URL(env.appUrl()).origin;
    } catch {}
    if (!ok) throw new ApiError("FORBIDDEN", "Cross-origin request blocked");
  }
}

/** Server-side owner check for every private action. Never rely on client route guards. */
export async function requireOwner(req: Request): Promise<Owner> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) throw new ApiError("UNAUTHENTICATED", "Sign in required");
  if (!session?.user?.isOwner || !env.ownerEmails().includes(email)) throw new ApiError("FORBIDDEN", "This account is not allowed");
  assertSameOrigin(req);
  if (!SAFE.has(req.method)) {
    const n = await hit(`own:${email}`, 60);
    if (n > 600) throw new ApiError("RATE_LIMITED", "Too many changes. Slow down for a minute.", undefined, { "Retry-After": "60" });
  }
  return { email };
}

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: Request, args: { owner: Owner; params: P }) => Promise<Response>;

/** Wrap an owner-only route handler: auth + CSRF + uniform error envelope. */
export function ownerRoute<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const owner = await requireOwner(req);
      return await handler(req, { owner, params: await ctx.params });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

/** For cron: constant-time compare of `Authorization: Bearer $CRON_SECRET`. */
export function requireCron(req: Request) {
  const secret = env.cronSecret();
  if (!secret) throw new ApiError("NOT_CONFIGURED", "CRON_SECRET is not set");
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.max(got.length, want.length); i++) diff |= (got.charCodeAt(i) || 0) ^ (want.charCodeAt(i) || 0);
  if (diff !== 0) throw new ApiError("UNAUTHENTICATED", "Invalid cron credentials");
}
