import type { Settings } from "./schema";

/**
 * Server-rendered HTML for the public link pages. These deliberately avoid React and the admin
 * bundle: tiny, fast, and impossible to confuse with the authenticated app. Every dynamic string
 * is HTML-escaped; there is no user-provided HTML anywhere.
 */
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

type Brand = Settings["brand"];
const safeAccent = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#4f46e5");

export function page(brand: Brand, o: { title: string; message: string; icon?: string; body?: string }): string {
  const accent = safeAccent(brand.accent);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(o.title)} · ${esc(brand.name)}</title><style>
:root{--bg:#fafafa;--fg:#171717;--mut:#6b7280;--card:#fff;--bd:#e5e5e5;--ac:${accent}}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#fafafa;--mut:#a3a3a3;--card:#171717;--bd:#2a2a2a}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--bd);border-radius:20px;padding:32px 28px;text-align:center}
.i{width:52px;height:52px;margin:0 auto 16px;border-radius:16px;display:grid;place-items:center;background:color-mix(in srgb,var(--ac) 14%,transparent);color:var(--ac);font-size:26px}
h1{font-size:1.25rem;margin:0 0 8px}p{margin:0;color:var(--mut)}form{margin-top:20px;display:grid;gap:12px}
input{font:inherit;padding:12px 14px;border-radius:12px;border:1px solid var(--bd);background:transparent;color:var(--fg)}input:focus-visible,button:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
button{font:inherit;font-weight:600;padding:12px 14px;border:0;border-radius:12px;background:var(--ac);color:#fff;cursor:pointer}
.e{color:#dc2626;font-size:.9rem}footer{margin-top:24px;font-size:.8rem;color:var(--mut)}
</style></head><body><main role="main"><div class="i" aria-hidden="true">${o.icon ?? "⚠"}</div><h1>${esc(o.title)}</h1><p>${esc(o.message)}</p>${o.body ?? ""}<footer>${esc(brand.footer || brand.name)}</footer></main></body></html>`;
}

export function gatePage(brand: Brand, slug: string, error?: string) {
  return page(brand, {
    title: "Password required",
    message: "Enter the password to continue to this link.",
    icon: "🔒",
    body: `<form method="post" action="/r/${esc(encodeURIComponent(slug))}" autocomplete="off"><label class="sr" for="p" style="position:absolute;left:-9999px">Password</label><input id="p" name="password" type="password" required autofocus autocomplete="off" placeholder="Password"${error ? ' aria-invalid="true" aria-describedby="err"' : ""}>${error ? `<div class="e" id="err" role="alert">${esc(error)}</div>` : ""}<button type="submit">Continue</button></form>`,
  });
}

export const PAGES = {
  notFound: (b: Brand) => page(b, { title: "Link not found", message: "This QR code does not point anywhere. Check the code or ask the person who shared it.", icon: "?" }),
  removed: (b: Brand) => page(b, { title: "Link removed", message: "The owner has removed this link.", icon: "✕" }),
  paused: (b: Brand) => page(b, { title: "Link paused", message: "This link is temporarily switched off by its owner. Please try again later.", icon: "⏸" }),
  notYet: (b: Brand, at: string) => page(b, { title: "Not active yet", message: `This link will start working on ${new Date(at).toUTCString()}.`, icon: "⏳" }),
  expired: (b: Brand, custom: string | null) => page(b, { title: b.expiredTitle, message: custom || b.expiredMessage, icon: "⌛" }),
  exhausted: (b: Brand, custom: string | null) => page(b, { title: "Scan limit reached", message: custom || "This link has reached the maximum number of scans.", icon: "∞" }),
  unavailable: (b: Brand) => page(b, { title: "Temporarily unavailable", message: "We can't load this link right now. Please try again in a minute.", icon: "☁" }),
  limited: (b: Brand) => page(b, { title: "Too many attempts", message: "Please wait a few minutes before trying again.", icon: "⏱" }),
  badDestination: (b: Brand) => page(b, { title: "Link misconfigured", message: "This link's destination is not valid, so we did not follow it.", icon: "⚠" }),
};

export const DEFAULT_BRAND: Brand = {
  name: "QR Studio",
  accent: "#4f46e5",
  expiredTitle: "This link has expired",
  expiredMessage: "The owner of this QR code has retired this link.",
  footer: "",
};
