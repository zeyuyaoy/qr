# Architecture

QR Studio is a single-owner Next.js 16 (App Router) PWA. QR codes are rendered in the browser; the server stores records, resolves dynamic links and keeps backups. Redis Cloud Free is the only datastore.

Related: [REDIS_SCHEMA.md](./REDIS_SCHEMA.md), [SECURITY.md](./SECURITY.md), [BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md).

## System overview

```
                               +--------------------------------------------+
   Phone camera / any browser  |  Vercel (Hobby)  - Next.js, Bun runtime   |
   scans printed QR            |                                            |
        |                      |  /r/[slug]  route handler (public)         |
        +--- GET /r/slug ----->|   resolve.ts -> public-pages.ts (plain HTML)|
        <---- 307 Location ----|        |  1-2 Redis round trips            |
                               |        v                                   |
   Owner's browser (PWA)       |  /api/*  owner API  (Auth.js session +     |      +---------------------------+
   React UI, IndexedDB cache,  |   guard.ts: auth, CSRF, rate limit)  ----->|----->|  Redis Cloud Free         |
   offline queue, service      |        |                                   | TCP  |  prefix qr:v1:  (+ research|
   worker                      |        v                                   | no   |  site keys, unprefixed)   |
        |                      |  repo.ts / scripts.ts (Lua) / maintenance  | TLS  +---------------------------+
        +-- HTTPS (cookie) --->|                                            |
                               |  /api/cron/backup <-- Vercel Cron 03:17 UTC|      +---------------------------+
                               |   backup/run.ts ---- snapshot, encrypt --->|----->|  GitHub private repo      |
                               +--------------------------------------------+ HTTPS|  snapshots/*.qrbackup.json|
                                                                                   +---------------------------+
   Google OAuth  <---- sign-in redirect / callback (/api/auth/*) ---->  Auth.js v5 (JWT session cookie)
```

Rendering model: pages are client components behind a server layout that checks the session; every QR image (preview, export, thumbnails, ZIP) is produced in the browser from the stored record. The server never renders or stores QR images, only the data to build them (and small logo images).

## Request flows

### 1. Public redirect hot path (`GET /r/<slug>`)

`src/app/r/[slug]/route.ts` -> `handleResolve` (`src/lib/resolve.ts`). No auth, no React, no admin bundle.

1. Validate the slug shape (`^[a-z0-9][a-z0-9_-]{2,63}$`, lower-cased) -> otherwise 404 page.
2. **Round trip 1:** `EVALSHA RESOLVE` returns the record, the scan counter and the settings JSON together.
3. Not found -> `EXISTS qr:v1:meta:schema`. Missing sentinel means "Redis looks wiped": **503** "Temporarily unavailable" with `Retry-After: 300`, not 404. Otherwise a `HIT` rate-limit call (60 misses / 10 min / visitor) and a 404 page.
4. `evaluateLink` decides the state from the server clock (`Date.now()`): removed, paused/archived, not yet active, expired, exhausted, or ok. Refusals render a status page (404/403/410) or, for expired/exhausted links with a valid replacement URL, a 307 to it (not counted).
5. The stored destination is re-validated with `checkDestination`; invalid -> 502 page.
6. Password-protected: GET returns the gate form (200, nothing counted); POST is handled by `handleGate` (below).
7. HEAD returns the same 307 without counting. POST on an unprotected link -> 405.
8. **Round trip 2:** `EVALSHA ACCEPT` atomically claims a scan slot (if there is a limit) and updates counters/statistics. Lost race for the last slot -> 410 "Scan limit reached".
9. Respond `307 Location: <destination>` with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`.

**Round-trip count (warm function):** 2 for every accepted GET (the final `ACCEPT` also checks record revision and expiry, even without analytics); 3 for an unknown slug (resolve, exists, hit); 3 waves for a correct password POST (resolve, two parallel `HIT`s, accept). On a cold instance add the TCP connect (<= 3 s timeout) and one `SCRIPT LOAD` per script used. No Redis call is made for authentication.

**Fail closed:** any Redis error on this path produces a 503 page; the resolver never falls back to a cached or guessed destination. This includes failures of the counting step: if `ACCEPT` cannot run, the visitor is not redirected.

**Password gate (`POST /r/<slug>`):** origin check (when `Origin` is present) -> two `HIT` calls (8 per 10 min per link+visitor, 80 per hour per link) **before** scrypt runs -> verify -> 303 to the destination (accepted scan) or 401 gate with an error (not counted).

### 2. Owner API

```
browser fetch (x-qr-csrf: 1, cookie) -> ownerRoute() [src/lib/guard.ts]
   requireOwner: Auth.js session -> isOwner && email in OWNER_EMAILS
   assertSameOrigin (non-GET): header + Origin
   writes: HIT own:<email> (600/min)
 -> handler: zod parse -> repo.ts (assertWritable: sentinel exists?) -> Lua PUT / plain commands
 -> {ok:true,data} | {ok:false,error:{code,message,details}}  via toErrorResponse()
```

Writes that change a record carry `ifRev` (required on PATCH). The Lua `PUT` script compares it with the stored `rev` atomically; a mismatch returns `REV_MISMATCH` with the current server copy in `details.current`.

### 3. Offline and sync

All client persistence is IndexedDB via `idb-keyval` (`src/lib/client/offline.ts`), in three separate kinds of data: **drafts** (unsaved editor state, never sent anywhere), **library cache** (a copy of server views, the server is the truth) and the **queue** of pending mutations (`create`, `update`, `trash`). A service worker (`public/sw.js`, production builds only) caches the app shell and hashed static assets; it never caches `/api/*`, `/r/*` or `/expired`.

```
 save while offline/unreachable -> queue.put(op) + optimistic view in cache (marked pending; dynamic links "not live")
 online / tab visible / every 30 s -> flushQueue(): replay in order
    create : idempotent via client opId (server returns the existing record for a repeated opId)
             SLUG_TAKEN -> op marked failed (user decides: new slug or discard)
    update : PATCH with ifRev = baseRev
             REV_MISMATCH -> server version WINS; the offline edit is saved as a NEW code "<name> (offline edit)"
    trash  : DELETE
    network/5xx -> stop, keep order, retry later
 success -> refresh cache from GET /api/codes
```

Conflict policy: **the server wins; nothing is silently overwritten and nothing is lost** (the offline edit survives as a copy). The copy uses a stable id derived from the queued operation and a fresh auto slug if dynamic. Previously password-protected copies remain paused unless the offline edit supplies a new password. Sign-out wipes IndexedDB and the page cache after warning about unsynced changes. Because `createdAt`/`updatedAt` are set by the server, an offline-created code gets its timestamps (and relative-expiry anchor) at sync time.

### 4. Backup

```
Vercel Cron 03:17 UTC --Bearer CRON_SECRET--> GET /api/cron/backup -> requireCron -> runBackup("cron")
 lock (SET NX EX 300) -> sentinel present? (else skip) -> collectSnapshot (index-driven reads, no decryption)
 -> decrypt newest matching remote snapshot and compare full contentHash (unchanged only if verified) -> gzip + AES-256-GCM envelope
 -> PUT snapshots/qr-<ts>-<hash8>.qrbackup.json via GitHub Contents API -> prune per retention
 -> write backup:status (last 30 runs) -> release lock
```

Manual runs (`POST /api/backup`) and the encrypted download use the same collect/pack code. Restore (`POST /api/backup/restore`, `bun run restore`) decrypts, verifies and plans against the live state; the dry run writes nothing. Full details: [BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md).

## Module map

| Path | Responsibility |
| --- | --- |
| `src/auth.ts` | Auth.js config: Google provider, owner allow-list, JWT session, test-only credentials provider |
| `src/lib/env.ts` | Lazy env access, `configReport()` (booleans only) |
| `src/lib/schema.ts` | zod schemas and types: records, style, settings, inputs, error codes; `SCHEMA_VERSION` |
| `src/lib/expiry.ts` | Pure link-state evaluation (precedence, absolute + relative expiry, scan limit) |
| `src/lib/url-safety.ts` | `checkDestination`, `withScheme`, `appHost` |
| `src/lib/crypto.ts`, `seal.ts` | AES-GCM helpers, scrypt, HMAC; sealing of Wi-Fi/vCard records |
| `src/lib/resolve.ts`, `public-pages.ts` | Public resolver and its server-rendered HTML pages |
| `src/lib/guard.ts`, `api.ts` | Owner/cron guards; response envelope, error mapping, `readJson` |
| `src/lib/redis/keys.ts` | Key builders, `assertOwnKey` |
| `src/lib/redis/client.ts` | Singleton connection, timeouts, no ambiguous write replay, `runScript` (EVALSHA + fallback) |
| `src/lib/redis/scripts.ts` | Lua: `PUT`, `PURGE`, `RESOLVE`, `ACCEPT`, `HIT` |
| `src/lib/redis/repo.ts` | Persistence boundary: codes, folders, tags, templates, settings, assets, analytics, meta, health |
| `src/lib/redis/maintenance.ts` | Index verify/repair, library import, restore upserts |
| `src/lib/redis/migrate.ts` | Forward-only record migrations |
| `src/lib/backup/{envelope,snapshot,github,run}.ts` | Encryption envelope; collect/pack/unpack/restore; GitHub client + retention; orchestration, status, freshness |
| `src/lib/analytics-report.ts`, `server-status.ts` | Report aggregation + CSV; status for the UI banners/recovery screen |
| `src/lib/qr/{payload,parse,style,render,export,readability}.ts` | Content encoders per type, scan-result parser, style -> renderer options, rendering, downloads/ZIP/print/share, readability checks |
| `src/lib/client/{api,offline,hooks,logo,session,time}.ts` | Typed API client, IndexedDB + sync, hooks, logo rasterisation, sign-out wipe, time-zone helpers |
| `src/app/(app)/*` | Private pages: Create (`/`), Library (+ `[id]`), Scan, Analytics, Templates, Bulk, Settings |
| `src/app/{login,expired,offline}` | Public pages |
| `src/app/api/**` | Route handlers ([reference](#api-reference)) |
| `src/components/**` | UI: app shell, recovery screen, editor, library, bulk, templates, scan, analytics, settings, shadcn/base-ui primitives |
| `public/sw.js`, `src/app/manifest.ts` | Service worker; web manifest incl. shortcuts and Web Share Target |
| `scripts/restore.ts`, `scripts/gen-icons.mjs` | Restore CLI; icon generator |

## API reference

Conventions:

- **Auth column:** `public`; `owner` = valid Auth.js session whose email is in `OWNER_EMAILS` (401 `UNAUTHENTICATED` without a session, 403 `FORBIDDEN` for another account); `cron` = `Authorization: Bearer $CRON_SECRET`.
- **Non-GET owner requests** also need `x-qr-csrf: 1` and, if sent, a same-origin `Origin` (403 `FORBIDDEN` otherwise), and count against 600 writes/min.
- All `/api/*` responses are `Cache-Control: no-store`. Request bodies are JSON, default limit 256 KB.
- Routes use Next.js's `runtime = "nodejs"` API compatibility target; `vercel.json` selects Bun as the deployment runtime.

### Envelope

```jsonc
// success
{ "ok": true,  "data": { ... } }
// failure
{ "ok": false, "error": { "code": "REV_MISMATCH", "message": "This code was changed elsewhere", "details": { ... } } }
```

`details` is optional (validation issues as `[{path, message}]`, or `{current}` for `REV_MISMATCH`). Unknown errors are logged by class name only and returned as `INTERNAL`.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No session / bad cron credentials |
| `FORBIDDEN` | 403 | Wrong account, missing CSRF header, cross-origin |
| `BAD_REQUEST` | 400 | Validation failed, bad JSON, unsafe destination, invalid confirmation |
| `NOT_FOUND` | 404 | Unknown id |
| `CONFLICT` | 409 | Id already exists (different `opId`) |
| `SLUG_TAKEN` | 409 | Slug used by another code |
| `REV_MISMATCH` | 409 | `ifRev` is stale; `details.current` holds the server copy |
| `RATE_LIMITED` | 429 | Limit hit; `Retry-After` header |
| `REDIS_UNAVAILABLE` | 503 | Redis unreachable, timed out, or `REDIS_URL` missing |
| `RECOVERY_REQUIRED` | 409 | Sentinel missing: library not initialised |
| `PAYLOAD_TOO_LARGE` | 413 | Body or content too large (also: content does not fit a QR at the chosen ECC) |
| `NOT_CONFIGURED` | 501 | Missing `DATA_ENCRYPTION_KEY` / `BACKUP_ENCRYPTION_KEY` / `CRON_SECRET`, or unusable key |
| `INTERNAL` | 500 | Anything else |

### Public routes

| Method | Path | Auth | Body | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET, HEAD | `/r/{slug}` | public | - | `307` to destination (HEAD never counts). HTML status pages: `404` not found/removed, `403` paused / not yet active, `410` expired / limit reached, `429` too many misses, `502` bad stored destination, `503` Redis down or wiped. Password-protected: `200` gate form | - (HTML, not the envelope) |
| POST | `/r/{slug}` | public | form field `password` | `303` to destination; `401` gate with error; `429`; `405` if the link has no password | - |
| GET | `/api/health` | public | - | `{ "ok": true }` 200, or `{ "ok": false }` 503 (PING + scripting + INFO) | - |
| GET | `/api/cron/backup` | cron | - | `{ ok, outcome, name?, records?, error? }` - 200, or 500 when the run failed | 401 `UNAUTHENTICATED`, 501 `NOT_CONFIGURED` |
| GET, POST | `/api/auth/*` | public | Auth.js | Auth.js sign-in/out/callback/session/csrf | - |
| GET | `/expired`, `/offline`, `/login`, `/manifest.webmanifest`, `/sw.js`, `/icons/*` | public | - | pages / assets | - |

### Owner routes

| Method | Path | Body / query | Response `data` | Notable errors |
| --- | --- | --- | --- | --- |
| GET | `/api/status` | - | config booleans, redis health (latency, tls, memory), `initialized`, `meta`, `recovery`, `backup` (configured, freshness, last run), `sealing`, `security`, `storage`, `user` | |
| POST | `/api/admin/init` | `{ confirm: "start-empty" }` | `Meta` (creates the sentinel with `SET NX`) | `BAD_REQUEST` |
| POST | `/api/admin/repair` | `{ apply?: boolean }` (default dry run) | `IndexReport` | `RECOVERY_REQUIRED` when `apply` and uninitialised |
| GET | `/api/codes` | `q, status (active*/archived/trashed/all), type, mode, folder (id/none), tag, favorite=1, state, sort (updated*/created/name/scans), dir, limit (<= 2000, default 1000), offset` | `{ items: QrView[], total, unreadable: string[] }` | |
| POST | `/api/codes` | `CreateInput` (`name, type, mode, payload, style` required; optional `id, opId, slug, fields, tags, folder, schedule, scanLimit, afterExpiry, password, ...`) | `QrView`, 201 | `BAD_REQUEST`, `SLUG_TAKEN`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `NOT_CONFIGURED`, `RECOVERY_REQUIRED` |
| GET | `/api/codes/{id}` | - | `QrView` (never includes the password hash; has `hasPassword`, `scans`, `linkState`) | `NOT_FOUND` |
| PATCH | `/api/codes/{id}` | partial fields + **`ifRev`** (+ `password`: string sets, `null` clears, omitted keeps) | `QrView` | `REV_MISMATCH`, `SLUG_TAKEN`, `NOT_FOUND`, `BAD_REQUEST` |
| DELETE | `/api/codes/{id}[?permanent=1]` | - | moves to trash (`QrView`); with `permanent=1` only from trash: `{ id, purged: true }` | `BAD_REQUEST` if not in trash |
| POST | `/api/codes/{id}/duplicate` | - | `QrView`, 201 (new id, "(copy)", fresh slug, **no password**, paused if source was protected) | `NOT_FOUND` |
| GET | `/api/codes/{id}/analytics` | `days` (1-365, default 30) | `AnalyticsReport` | |
| POST | `/api/codes/batch` | `{ ids (1-200), action, value? }`; actions: `archive restore trash purge favorite unfavorite pin unpin enable disable tag-add tag-remove move-folder apply-template` | `{ results: [{id, ok, error?}], succeeded }` (per-id outcomes; 200 even if some fail) | `NOT_FOUND` (template) |
| POST | `/api/codes/bulk` | `{ items (1-200) }`, <= 2 MB | `{ results: ApiResult<QrView>[], created }` (per-row envelopes) | |
| GET, POST | `/api/folders` | POST `{ name, color? }` | list with counts / `Folder` 201 | |
| PATCH, DELETE | `/api/folders/{id}` | `{ name, color? }` | `Folder` / `{ unfiled }` (codes are un-filed, never deleted) | `NOT_FOUND` |
| GET, POST | `/api/tags` | POST `{ from, to }` (`to: null` deletes; existing name merges) | `[{tag,count}]` / `{ updated }` | |
| GET, POST | `/api/templates` | POST `{ name, style }` | `Template[]` / `Template` 201 | |
| PATCH, DELETE | `/api/templates/{id}` | `{ name, style }` | `Template` / `{ deleted: true }` | `NOT_FOUND` |
| GET, PUT | `/api/settings` | PUT: `Settings` (defaults fill gaps) | `Settings` | |
| POST | `/api/assets` | `{ dataUrl }` (<= 32 KB body, <= 20,000 chars, decoded <= 12 KB, png/jpeg/webp, magic bytes checked) | `{ id }` 201 | `PAYLOAD_TOO_LARGE`, `BAD_REQUEST` |
| GET | `/api/assets/{id}` | - | `{ dataUrl }` with `Cache-Control: private, max-age=31536000, immutable` | `NOT_FOUND` |
| GET | `/api/analytics` | `from, to (YYYY-MM-DD), id, format=csv` | `AnalyticsReport` or a CSV file | `BAD_REQUEST` |
| POST | `/api/analytics/reset` | `{ id?, confirm: "reset" }` | `{ deleted }` (also resets scan-limit counters) | |
| GET | `/api/library/export` | `format=json\|csv` | file download; JSON includes referenced logo assets, decrypted Wi-Fi/vCard and no password hashes (`hadPassword` flag); CSV masks sensitive payloads | |
| POST | `/api/library/import` | `{ data, dryRun (default true), policy: skip\|overwrite\|duplicate }`, <= 8 MB | `ImportReport`; passwords are never imported | `BAD_REQUEST`, `RECOVERY_REQUIRED` |
| GET | `/api/backup` | - | `{ configured, freshness, status, snapshots[<=40], listError }` | |
| POST | `/api/backup` | - | `BackupRun` (3/min limit) | `RATE_LIMITED` |
| GET | `/api/backup/download` | - | encrypted `.qrbackup.json` attachment | `NOT_CONFIGURED`, `RECOVERY_REQUIRED` |
| POST | `/api/backup/restore` | `{ source: {github: name} \| {text}, dryRun (default true), mode (merge*/replace), prefer (newer*/snapshot/existing), confirm? }`, <= 40 MB | `{ report: RestoreReport, envelope }` | `BAD_REQUEST` (bad file/key, replace without `confirm: "replace"`), `NOT_CONFIGURED`, `RATE_LIMITED` (6/min) |

`*` marks defaults. Vercel enforces its own request-body limit (documented as 4.5 MB for Functions) before the code runs, so very large restore uploads should use the CLI.

## Decisions and trade-offs

| Decision | Why | Cost |
| --- | --- | --- |
| **Lua scripts** for writes and the hot path | Redis Cloud Free is a single node; scripts give atomic slug claim, index maintenance, compare-and-set on `rev` and race-free scan limits without transactions-with-WATCH retries. `RESOLVE` makes the read path one round trip. | Logic lives in Lua strings; key names built from `ARGV` would break on Redis Cluster; porting needs equivalents ([REDIS_SCHEMA.md](./REDIS_SCHEMA.md#migration-path)). |
| **No TTL on canonical records** | Nothing the owner created may silently expire; only analytics, rate limits and the lock have TTLs. | Memory only shrinks by explicit deletion; analytics retention is the sizing lever. |
| **Server-authoritative time** | Link state uses the server's `Date.now()`, never a client clock. Schedules are stored as UTC ISO; the UI converts from the owner's chosen time zone. `createdAt`/`updatedAt` are set by the server. | An offline-created code is "created" when it syncs. Server clock skew (small on Vercel) shifts expiries equally for everyone. |
| **Sealing Wi-Fi/vCard records** | They contain secrets and the Redis link is unencrypted. AES-256-GCM with the record id as AAD, so a blob cannot be moved to another record. | Needs a second key; rotation is manual; names/tags/folders of those records stay readable. |
| **Content-addressed logo assets <= 12 KB** | Keeps binaries out of records (records stay ~1 KB), deduplicates, makes uploads idempotent (the id is the SHA-256 prefix, computed identically in the browser and on the server), bounds memory. The browser rasterises everything, which also strips SVG scripts. | Logos are small (<= 192 px, WebP/PNG). Orphans accumulate until repair. |
| **Sentinel `meta:schema`** | The app never creates it implicitly. If Redis answers but the sentinel is gone, writes stop, links answer 503 and the owner picks restore or start-empty. Distinguishes first run and total loss from an empty library. | Detects total wipes only. First run needs one click. |
| **Fail-closed resolver** | On any Redis failure a visitor gets a 503 page, never a redirect that skipped limit/expiry checks or a stale destination. Scan limits and expiry are therefore reliable. | Dynamic links are down whenever Redis is down, full (write errors on the counting step) or wiped. Static codes are unaffected. |
| **Offline conflict policy: server wins + "(offline edit)" copy** | Deterministic, no merge UI, no data loss. | The owner may need to reconcile two codes manually; the copy carries no password and a new slug. |
| **Accepted-scan definition** | A scan counts only if the request passed state checks, the password (if any) and, when a limit exists, atomically claimed a slot. HEAD requests, password-gate renders, wrong passwords, redirects to the expiry replacement, and every refusal are not counted. | See "link previews" below. |
| **Counters only when needed** | If analytics is off for a code (or globally) and there is no scan limit, `ACCEPT` is skipped entirely and nothing is written: fewer writes and smaller memory use. | The "scans" total for such a code stays 0. |
| **`'unsafe-inline'` CSP** | See [SECURITY.md](./SECURITY.md#headers-and-csp). | Weaker second line against XSS. |
| **Plain-HTML public pages** | Tiny, fast, no hydration, cannot be confused with the app, strict CSP with no script. | Duplicated styling; not themable beyond name, accent colour, expiry text and footer. |

## Performance notes

- **Rendering happens on the client.** The server stores ~1 KB records; QR geometry, styling, previews, thumbnails, PNG/SVG/WebP/JPEG export, ZIP and print are all browser-side. The server cost of showing a QR is zero.
- **Lazy chunks.** The QR renderer (`qr-code-styling`) is a dynamic import loaded at the first render; the scanner fallback decoder (`jsQR`) is a dynamic import used when the native `BarcodeDetector` is missing or fails; library thumbnails render only near the viewport (`LazyQr`, one shared `IntersectionObserver`); logos are fetched once per id and cached (memory, then IndexedDB, with immutable cache headers).
- **No admin bundle on `/r`.** The resolver is a route handler returning a string; no React, no client JS, no cookies, no session lookup. Hot path: 1-2 Redis round trips.
- **Library listing is O(number of codes).** `GET /api/codes` and analytics reports read every record (`MGET` in chunks of 400, <= 10,000 records) and filter/sort in memory. Fine for hundreds to low thousands of codes; the cap is `MAX_CODES = 10,000`.
- **One connection per function instance**, 5 s operation timeout, no queueing of commands on a dead socket.
- **Service worker** precaches the shell and `/_next/static` assets and serves navigations network-first with a 4 s timeout, falling back to the cached page or `/offline`.

## Known limitations

Redis Cloud Free:

- **No TLS.** Everything not sealed crosses the network readable ([SECURITY.md](./SECURITY.md#redis-transport-is-not-encrypted-on-the-free-tier)).
- **No persistence guarantee, no provider backups.** Data can be lost; the daily GitHub snapshot is the only protection and loses up to a day of changes.
- **Shared failure domain** with the research site: its resets, flushes, memory use and connections affect this app, and vice versa.
- **Inactivity deletion risk.** Free databases may be removed after prolonged inactivity (verify Redis Cloud's current rule). Keep the database in use. The daily cron job reads and writes Redis (lock, sentinel check, status) whenever `CRON_SECRET` is set and the deployment is live, so it happens to generate activity; it is not designed or tested as a keep-alive and does nothing if the cron secret is missing, the cron job is removed, or the project is paused.
- **Connection limit** (about 30 for the whole database): one connection per warm function instance plus the other site.
- **30 MB memory.** At the limit Redis rejects writes (assuming no eviction policy; the app neither sets nor checks one) and the resolver answers 503 for links that need counting.

Application:

- **Offline:** individual `/library/[id]` pages work offline only if they were visited before (and cached); nothing private is cached by the service worker except page HTML for the precached routes; the library list works from the IndexedDB copy; edits to existing codes offline are queued; creating or editing a dynamic link offline does not make it live until sync. The service worker is registered only in production builds.
- **Web Share Target** works only where the browser supports it (Chromium on Android, installed PWA). Other browsers ignore the manifest entry.
- **Clipboard image copy** (`ClipboardItem`) is unsupported or permission-gated in some browsers; the UI reports it and offers Download.
- **Geo analytics** work only on Vercel (needs the `x-vercel-ip-country` header and `VERCEL=1`).
- **Scans from previews/unfurlers.** Link-preview bots and some messaging apps fetch URLs with GET. They are classified as device `bot` when their user agent matches, but still count as accepted scans and can consume a scan limit. HEAD requests are not counted.
- **No nonce-based CSP** (`script-src 'unsafe-inline'`).
- **Analytics granularity:** daily UTC buckets, counts only. No unique visitors, no referrers, no per-scan log beyond the last 100 entries.
- **Static codes are not tracked** (they never pass through the server) and cannot be edited after printing.
- **Passwords are not exported.** JSON export/import and the device-cache restore drop link password hashes; snapshots keep them.
- **Single owner, single library.** No sharing, roles or teams.
- **One user-visible time zone setting**; the server stores UTC.
- **Search is client-side/in-memory**; static payloads (which may hold Wi-Fi passwords) are never searched.
- **`DATA_ENCRYPTION_KEY` has no versioning**; rotation is manual ([DEPLOYMENT.md](./DEPLOYMENT.md#rotating-data_encryption_key)).
- **Scan counters can double-count in rare cases:** the client retries a command once after a connection error even if the first one may have been executed.
