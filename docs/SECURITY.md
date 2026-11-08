# Security

What QR Studio protects, how, and where the protection stops. Everything here is derived from the code; where a control is absent it says so.

## Summary

- Single owner. Google sign-in only, allow-listed by verified email (`OWNER_EMAILS`). No registration, no passwords of its own.
- The only public surface is the redirect resolver `/r/<slug>`, a small server-rendered handler with no admin code and no user-controlled destination.
- Redis Cloud Free is the only datastore and it has **no TLS and no durability guarantee**. Compensating controls: sealing of Wi-Fi and vCard records, hashed link passwords, encrypted backups.
- Several things still cross the network in clear text. See [What is and is not encrypted](#what-is-and-is-not-encrypted).

## Redis transport is not encrypted on the free tier

This is the most important limitation of the deployment. `REDIS_URL` must be `redis://`; the free plan offers no TLS. Anyone able to observe traffic between the Vercel function and Redis Cloud (on-path network attacker, compromised hop) can read **everything that is not sealed**, including the Redis password itself (sent in `AUTH`), and can inject commands.

The app surfaces this honestly: `health()` reports `tls: false`, and Settings -> Data shows the warning. The only real fixes are a paid Redis plan with TLS (`rediss://`) or another datastore ([REDIS_SCHEMA.md](./REDIS_SCHEMA.md#migration-path)). Rotating the Redis password reduces the window after a suspected leak but does not change the transport.

## Threat model

| Threat | Control actually implemented | Residual risk |
| --- | --- | --- |
| **Public redirect abuse** (using `/r/` as an open redirector or to reach internal hosts) | Destination comes only from the owner-written record; there is no URL parameter. Stored destinations are re-validated on every hit (`checkDestination`): http/https only, no credentials, no whitespace/control characters, no localhost/`.local`/`.internal`, no private/loopback/link-local/CGNAT IPv4 literals, no private IPv6 literals, no `/r/` links back to this app. Invalid -> 502 page, no redirect. | Public domains and DNS names that resolve to private addresses are not detected (no DNS resolution; the redirect is performed by the visitor's browser, not by the server, so this is not SSRF). A destination the owner chose can later turn malicious; QR Studio does not scan destinations. |
| **Unauthorized creation / admin access** | Every private route is wrapped in `ownerRoute` -> `requireOwner`: valid session, `isOwner` claim, and the email re-checked against the live `OWNER_EMAILS`. Private pages are gated server-side in `(app)/layout.tsx`. Google sign-in additionally requires `email_verified`. No account linking (`allowDangerousEmailAccountLinking: false`). | Account takeover of the owner's Google account. No second factor is added by the app (use Google's). Test auth, if enabled by mistake, bypasses Google ([below](#test-authentication)). |
| **Malicious URLs entered by the owner** | Same `checkDestination` runs in the browser (live feedback), in `validateRecord` on create/update/import, and again in the resolver. `afterExpiry.redirectUrl` is validated the same way. | As above. |
| **XSS** | Public pages are built by string templates with every dynamic value HTML-escaped (`esc`), a validated hex accent colour, and a `default-src 'none'` CSP that allows no script at all. The app is React (escaped by default); no `dangerouslySetInnerHTML` of user data is used for content. CSV export neutralises spreadsheet formulas. App CSP: `script-src 'self' 'unsafe-inline'` (see [CSP](#headers-and-csp)). | `'unsafe-inline'` weakens CSP as a second line of defence: an injection bug would not be blocked by CSP. Mitigated by escaping, not eliminated. |
| **CSRF** | See [CSRF design](#csrf-design). | Requests without an `Origin` header (non-browser clients) rely on the custom header alone. Browsers cannot add that header cross-origin without a CORS preflight, which the API never approves. |
| **Credential and secret leakage** | Secrets are read lazily from env and never logged (`env.ts`; Redis errors are swallowed because they can embed the URL; error responses carry no internals). Status endpoints return booleans, not values. E2E asserts that public output contains no secret. `.env*.local` is git-ignored. Password hashes are never returned by the API (`toView`) or exported to JSON/CSV. | Secrets live in Vercel and in your password manager. Redis password travels in clear text (above). GitHub token and Redis URL exist in function memory. |
| **Namespace collisions with the research site** | All keys start with `qr:v1:`; research uses unprefixed keys. Lua scripts and bulk operations only touch prefixed keys (`assertOwnKey`); no `KEYS`, `FLUSHDB`, `FLUSHALL`. | Shared memory, connections and failure domain. A bug or a `FLUSHDB` on the research side would still destroy QR Studio data (hence backups). |
| **Open redirects** | `/r/` only redirects to validated stored URLs. Login `next` accepts only paths beginning with `/` and not `//`. | The `next` check does not reject a leading `/\`, which some browsers normalise to `//`. It is reachable only for an already signed-in owner and is a hardening item. |
| **Link password brute force** | scrypt hashing; attempts limited to 8 per 10 min per (link, visitor) and 80 per hour per link, checked **before** the hash is computed; wrong attempts are not counted as scans. Password length 4-128. | Short passwords remain guessable within the per-link ceiling (80 tries/hour). Limits are per IP-hash, so a distributed attacker gets 80/hour/link in total, not more. |
| **QR / image injection (logo)** | Logos are rasterised in the browser to PNG/WebP at <= 192 px and <= 12 KB; SVG input cannot keep scripts, external references or metadata. The server accepts only `data:image/(png\|jpeg\|webp);base64`, checks the magic bytes against the declared type, caps decoded size at 12 KB, and stores it content-addressed. Logos render through `<img>`/canvas, never inline. | A hostile image that is a valid PNG/JPEG/WebP is stored as-is; browser image decoders are the remaining attack surface. |
| **Backup exposure** | Snapshots are AES-256-GCM encrypted (key never leaves the server environment), written to a private GitHub repo with a repo-scoped token. Download is encrypted-only (no plaintext dump endpoint). | Git history keeps pruned snapshots; anyone who later obtains `BACKUP_ENCRYPTION_KEY` can open **every** snapshot ever committed. The GitHub token can delete or overwrite backups. Metadata (file names, sizes, commit times) is visible to GitHub and repo readers. |
| **Oversized uploads / bodies** | `readJson` limits: 256 KB default; 32 KB for assets (plus dataUrl <= 20,000 chars, decoded <= 12 KB); 2 MB bulk create (<= 200 items); 8 MB library import; 40 MB restore upload; batch <= 200 ids. Codes: 4,000-char payload, 120-char names, 20 tags. `MAX_CODES = 10,000`. | Platform limits on Vercel apply first (documented request-body limit of about 4.5 MB for Functions). |
| **DoS on a limited Redis** | Fixed-window rate limits ([list](#rate-limits-implemented)); unknown-slug flood limited per visitor; owner writes limited; scans of valid links are intentionally not limited. Short TTLs on rate-limit keys; analytics keys expire by retention. | `/api/health` is public and unthrottled (each call runs PING, EVAL and INFO). Valid-slug hits cost two Redis operations each and are not rate limited, so a determined flood from many IPs can exhaust the free tier's throughput or memory. Consider Vercel firewall rules. |
| **Analytics privacy** | See [Privacy](#privacy). | Aggregate counters cannot be attributed to a person; the 100-entry "recent" list holds code id, device category and time. |
| **Redis data loss mistaken for empty library** | Sentinel key `qr:v1:meta:schema`; writes blocked and public links answer 503 (not 404) until the owner decides ([BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md)). | Detects total wipes only. Partial loss or restoration of an older Redis snapshot with the sentinel intact is not detected. |
| **Link previews / bots counted as scans** | A user-agent classifier labels crawlers as device `bot`. | They are still *accepted* scans and consume scan limits; see [Known limitations](./ARCHITECTURE.md#known-limitations). |

## Auth model

- **Provider:** Google via Auth.js v5. `signIn` callback: Google profile must have `email_verified === true` and an email in `OWNER_EMAILS`.
- **Session:** encrypted JWT (JWE) in an `httpOnly` cookie, 7-day lifetime, refreshed after 1 day. Nothing about sessions is stored in Redis.
- **Revocation:** the `jwt` callback re-evaluates `isOwner` on refresh, and `requireOwner` re-checks the live `OWNER_EMAILS` on every API call. Removing an address (and redeploying) locks that user out of the API immediately; there is no server-side session list to revoke a still-valid cookie other than rotating `AUTH_SECRET` (signs everyone out).
- **Authorization:** one role. `isOwner` or nothing. Defence in depth: server-side `redirect("/login")` for pages, `requireOwner` for APIs, the client guards are only convenience.
- **Auth.js endpoints** (`/api/auth/*`) have no additional rate limiting from this app.

### Test authentication

`ENABLE_TEST_AUTH=1` registers a credentials provider that signs in the owner without Google when `TEST_AUTH_SECRET` matches. The code turns it off only when `VERCEL_ENV === "production"` (`env.testAuthEnabled`). On a Vercel preview, on a self-hosted `next start`, or anywhere else the variable is honoured. The E2E suite relies on exactly that. Never create the variables in Vercel.

## CSRF design

Mutating requests (anything other than GET/HEAD/OPTIONS) to private routes must pass `assertSameOrigin`:

1. **Custom header:** `x-qr-csrf: 1` must be present (the typed client adds it to every call). A cross-site form or simple `fetch` cannot set it without a CORS preflight, which the API never grants.
2. **Origin check:** if an `Origin` header is sent it must equal the request host or the host of `NEXT_PUBLIC_APP_URL`; otherwise `403 FORBIDDEN`. A request with no `Origin` is accepted on the strength of the header alone.
3. **SameSite:** the Auth.js session cookie is `SameSite=Lax`, so it is not sent on cross-site sub-requests or POSTs.

The public password gate (`POST /r/<slug>`) has no session to protect; it applies an Origin check when an `Origin` header is present and the brute-force limits. Auth.js sign-in/sign-out use Auth.js's own CSRF token. The cron route is protected by its bearer secret, not by cookies.

## Headers and CSP

Set globally in `next.config.ts`:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (adds `'unsafe-eval'` only in development); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`; `font-src 'self' data:`; `connect-src 'self'`; `worker-src 'self'`; `manifest-src 'self'`; `media-src 'self' blob:`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self' https://accounts.google.com`; `frame-ancestors 'none'`; `upgrade-insecure-requests` on Vercel |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` |
| `/api/*` | `Cache-Control: no-store` |
| `/sw.js` | `Cache-Control: no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /` |
| `X-Powered-By` | removed |

The `/r/*` handler additionally sets its own response headers: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex[, nofollow]`, and for HTML pages a CSP of `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`. Because `next.config.ts` also matches `/r/*`, check with `curl -I` which CSP your browser ends up seeing.

**`script-src 'unsafe-inline'` trade-off.** Next.js emits inline bootstrap scripts, and a hash- or nonce-based policy needs per-request rendering (or build-time hashes). The app chose `'unsafe-inline'` so statically rendered shells keep working and can be precached for offline use. The path to nonces: add a `proxy.ts` (Next.js 16 middleware) that generates a nonce per request and sets `script-src 'nonce-...' 'strict-dynamic'`, and make the affected routes dynamic. The cost is losing static shells for offline precaching (the service worker precaches HTML) and CDN caching. Not implemented.

## Rate limits implemented

All are fixed windows in Redis (`qr:v1:rl:<bucket>:<window>`, TTL = 2x window). Counts exceed the limit -> `429`.

| What | Limit | Key | Source |
| --- | --- | --- | --- |
| Owner writes (any non-GET/HEAD/OPTIONS owner request) | 600 per 60 s | per owner email | `requireOwner` |
| Manual backup | 3 per 60 s | global | `POST /api/backup` |
| Restore (dry runs included) | 6 per 60 s | global | `POST /api/backup/restore` |
| Unknown slug lookups (404s) | 60 per 600 s | per visitor hash | `handleResolve` |
| Link password attempts | 8 per 600 s | per (slug, visitor hash) | `handleGate` |
| Link password attempts | 80 per 3600 s | per slug (all visitors) | `handleGate` |
| Backup concurrency | 1 running (lock, 300 s expiry) | global | `runBackup` |

Not rate limited by this app: valid-slug redirects, `/api/health`, owner reads, Auth.js endpoints. Fixed windows allow up to twice the limit across a window boundary.

## Password hashing

Link passwords use **scrypt** (Node `crypto.scrypt`, no native dependency): `N=16384`, `r=8`, `p=1`, 32-byte key, 16-byte random salt, input normalised with Unicode NFKC, comparison with `timingSafeEqual`. The stored string is self-describing (`scrypt$N$r$p$salt$hash`) so parameters can be raised later and old hashes still verify. A malformed stored hash verifies as `false` rather than throwing. These parameters are the common interactive baseline (not tuned to the Vercel CPU); the attempt limits above are the main defence.

## What is and is not encrypted

| Data | In Redis | In transit to Redis (free tier) | In GitHub backups | In the browser |
| --- | --- | --- | --- | --- |
| Wi-Fi and vCard content (`payload`, `fields`) | **Sealed**: AES-256-GCM, `DATA_ENCRYPTION_KEY`, AAD = record id; stored as `payload:"sealed"` + `sealed` blob | Ciphertext only | Ciphertext (sealed blob inside the encrypted snapshot) | Decrypted copy in IndexedDB cache and drafts until sign-out |
| Record names, descriptions, tags, folder, style, schedule, flags | Clear text (needed by Lua / indexes) | **Clear** | Encrypted | Clear |
| URL / social / DOI / WhatsApp / text / email / phone / sms / geo / event content | Clear text | **Clear** | Encrypted | Clear |
| Dynamic link destinations and slugs | Clear text | **Clear** | Encrypted | Clear |
| Link password | scrypt hash (inside the record) | Hash in clear | Hash inside the encrypted snapshot | Never sent back to the client |
| Folders, templates, settings (incl. brand text) | Clear text | **Clear** | Encrypted | Clear |
| Logo images | Clear data URL (<= 12 KB) | **Clear** | Encrypted | Clear |
| Aggregate scan counters, per-day stats | Clear text | **Clear** | Encrypted | - |
| Redis password | - | **Clear** (`AUTH`) | - | - |
| Rate-limit keys | HMAC'd visitor ids; owner email appears in the key name `rl:own:<email>:<window>` for <= 120 s | Clear | Not included | - |

Note that sealing hides the content of Wi-Fi and vCard codes but not their existence, name, tags or folder (a code named "Home Wi-Fi" is visible to a network observer). Sealed records are never searched by their static payload. The JSON library export contains decrypted Wi-Fi/vCard values; the CSV export masks them.

## Privacy

- **No raw IP addresses are stored.** The client IP (from `x-real-ip` / `x-forwarded-for`, set by Vercel) is turned into a 22-character HMAC-SHA256 (keyed with `AUTH_SECRET`) used only in rate-limit bucket names, which expire within minutes to two hours.
- **No user-agent strings are stored.** Only a coarse category (`mobile`, `tablet`, `desktop`, `bot`, `other`), and only if "Device categories" is on.
- **Country** is recorded only if "Country" is on (default off) **and** `VERCEL=1` **and** the `x-vercel-ip-country` header holds two capital letters. Off Vercel, geo is never recorded.
- Stored analytics: per-day hashes of counts (total, per device, per country, per code) with a TTL of retention + 1 day (default retention 90 days, range 7-365), and a list of the last 100 accepted scans (`time|codeId|device`, no TTL, trimmed by length). Scan totals per code have no TTL. Resetting analytics removes all of these, and also **resets scan-limit counters**.
- No cookies are set on the public redirect path. No third-party scripts or fonts are loaded; `connect-src 'self'`.
- Daily buckets are UTC.

## Secrets handling

- Names and purposes: [`.env.example`](../.env.example). Generate with `openssl`, store in a password manager independent of Vercel and GitHub.
- Server-only variables are never exposed to the browser. Public build variables contain only the app URL and service-worker build version.
- The two encryption keys are independent; compromise of one does not reveal the other. `BACKUP_ENCRYPTION_KEY` is never used for Redis records and `DATA_ENCRYPTION_KEY` never for snapshots.
- The restore CLI refuses to write to a non-local Redis, or in replace mode, without `--yes`.
- Rotation: [DEPLOYMENT.md](./DEPLOYMENT.md#rotating-secrets).

## Known limitations

- Redis traffic unencrypted (above); free Redis has no durability guarantee.
- No nonce-based CSP; `'unsafe-inline'` for scripts and styles.
- No per-key versioning for `DATA_ENCRYPTION_KEY`; rotation is manual.
- Pruned snapshots stay in git history; the backup key is a long-lived master key for all of them.
- Restoring link passwords works from snapshots (hashes are inside them) but not from the JSON library export/import or the "rebuild from this device's cache" option, which both clear passwords: previously protected links are imported **paused** until the owner sets a new password and enables them. Protected duplicates and offline conflict copies also start paused when no new password is available.
- The IndexedDB cache on the owner's devices holds decrypted records (including Wi-Fi/vCard) until sign-out wipes it; a lost, unlocked device with a live session exposes them.
- Public redirect traffic is not bot-filtered or throttled per visitor.
- Login return paths reject protocol-relative and slash-backslash prefixes.
- No audit log of owner actions beyond record revisions and the backup history.

## Reporting a vulnerability

This is a personal project. Report security issues privately to the owner (the address on the GitHub profile of the repository owner) rather than opening a public issue, include reproduction steps, and allow reasonable time to respond. There is no bug bounty.
