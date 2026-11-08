/**
 * Destination validation for dynamic links and QR URL payloads.
 * Rules: absolute http(s) only, no credentials, no control chars, no loopback/private literals,
 * and never our own redirector (prevents loops). The string is returned UNCHANGED when valid —
 * we deliberately do not re-serialize, so query strings and fragments keep their exact bytes.
 */
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

export function checkDestination(input: string, opts: { appHost?: string } = {}): UrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "URL is empty" };
  if (raw.length > 2048) return { ok: false, reason: "URL is longer than 2048 characters" };
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return { ok: false, reason: "URL contains spaces or control characters" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid absolute URL" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: "Only http and https destinations are allowed" };
  }
  if (u.username || u.password) return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  // A trailing dot ("localhost.") names the same host; strip it so the checks below cannot be bypassed.
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") && !host.startsWith("[")) return { ok: false, reason: "Host must be a public domain name" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "Local and internal hosts are not allowed" };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_V4.some((r) => r.test(host))) {
    return { ok: false, reason: "Private IP addresses are not allowed" };
  }
  if (host.startsWith("[") && /^\[(::1?|fc|fd|fe80)/i.test(host)) {
    return { ok: false, reason: "Private IPv6 addresses are not allowed" };
  }
  if (opts.appHost && host === opts.appHost.toLowerCase() && u.pathname.startsWith("/r/")) {
    return { ok: false, reason: "A dynamic link cannot point at another QR Studio link" };
  }
  return { ok: true, url: raw };
}

/** Prepend https:// when the user typed a bare host such as `example.com/path`. */
export function withScheme(input: string): string {
  const t = input.trim();
  if (!t) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^/]+:\d+(\/|$)/.test(t)) return t;
  return `https://${t.replace(/^\/\//, "")}`;
}

export function appHost(appUrl: string | undefined): string | undefined {
  try {
    return appUrl ? new URL(appUrl).hostname : undefined;
  } catch {
    return undefined;
  }
}
