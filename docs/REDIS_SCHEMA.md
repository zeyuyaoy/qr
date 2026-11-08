# Redis schema

Everything QR Studio stores lives in one Redis database under the namespace prefix **`qr:v1:`** (`src/lib/redis/keys.ts`). The research site (research.zeyuyaoy.com) uses unprefixed keys (`link:`, `meta:`, `tag:`, `collection:`) in the same database; the two do not overlap.

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md), [SECURITY.md](./SECURITY.md).

## Key patterns

"Canonical" keys hold primary data and never expire. "Derived" keys can be rebuilt from canonical ones ([repair](#index-consistency-and-repair)).

| Key | Type | Kind | Example | Written by | TTL |
| --- | --- | --- | --- | --- | --- |
| `qr:v1:meta:schema` | string (JSON `{schemaVersion, initializedAt, instanceId}`) | canonical (sentinel) | `{"schemaVersion":1,"initializedAt":"2026-11-08T10:00:00.000Z","instanceId":"k3j..."}` | `initMeta` (`SET NX`), restore | none |
| `qr:v1:code:{id}` | string (JSON record; Wi-Fi/vCard sealed) | canonical | `qr:v1:code:ab12cd34ef56gh` | `PUT` script, import, restore | none |
| `qr:v1:count:{id}` | string (integer: accepted scans) | canonical | `qr:v1:count:ab12cd34ef56gh` -> `"42"` | `ACCEPT` script (`INCR`), restore (`SET NX`), deleted by `PURGE`/reset | none |
| `qr:v1:folder:{id}` | string (JSON) | canonical | | `saveFolder`, restore | none |
| `qr:v1:template:{id}` | string (JSON style template) | canonical | | `saveTemplate`, restore | none |
| `qr:v1:settings` | string (JSON) | canonical | | `saveSettings`, restore | none |
| `qr:v1:asset:{hash32}` | string (data URL, <= 12 KB decoded) | canonical | `qr:v1:asset:9f2c...` (first 32 hex of SHA-256) | `putAsset` (`SET NX`), restore | none |
| `qr:v1:slug:{slug}` | string (code id) | derived | `qr:v1:slug:k7m2x9q` -> `ab12cd34ef56gh` | `PUT`/`PURGE` scripts, repair | none |
| `qr:v1:index:codes` | sorted set (member = id, score = `createdAt` ms) | derived | | `PUT`/`PURGE`, repair | none |
| `qr:v1:index:folder:{folderId}` | set of code ids | derived | | `PUT`/`PURGE`, repair | none |
| `qr:v1:index:tag:{tag}` | set of code ids | derived | | `PUT`/`PURGE`, repair | none |
| `qr:v1:index:tags` | set of tag names | derived | | `PUT`/`PURGE`, repair | none |
| `qr:v1:index:folders` | set of folder ids | canonical-ish | | `saveFolder`, `deleteFolder`, restore | none |
| `qr:v1:index:templates` | set of template ids | canonical-ish | | `saveTemplate`, `deleteTemplate`, restore | none |
| `qr:v1:stats:{id}:{YYYYMMDD}` | hash: `n`, `d:<device>`, `c:<CC>` | analytics | `qr:v1:stats:ab12cd34ef56gh:20261108` | `ACCEPT` script, restore | `(retentionDays + 1) * 86400` s, refreshed on each accepted scan |
| `qr:v1:stats:all:{YYYYMMDD}` | hash: as above plus `k:<codeId>` | analytics | `qr:v1:stats:all:20261108` | `ACCEPT` script, restore | same |
| `qr:v1:recent` | list of `epochSeconds|codeId|device`, newest first, max 100 | analytics | | `ACCEPT` script (`LPUSH` + `LTRIM`) | none (bounded by length) |
| `qr:v1:rl:{bucket}:{window}` | string (integer) | rate limit | `qr:v1:rl:pw:k7m2x9q:<visitor>:2968400` | `HIT` script | `2 x windowSeconds` |
| `qr:v1:backup:status` | string (JSON, last 30 runs) | operational | | `runBackup` | none |
| `qr:v1:backup:lock` | string (ISO time) | operational | | `runBackup` (`SET NX EX 300`) | 300 s |

Rate-limit buckets in use: `own:<email>` (60 s), `miss:<visitor>` (600 s), `pw:<slug>:<visitor>` (600 s), `pwl:<slug>` (3600 s), `restore` (60 s), `backup-now` (60 s). `<visitor>` is an HMAC of the client IP ([SECURITY.md](./SECURITY.md#privacy)). The window index is `floor(now / windowSeconds)`, so a bucket key is unique per window and expires by itself.

`ids` are 14 random characters of `[a-z0-9]` (the schema accepts 8-24); slugs are 3-64 characters `[a-z0-9_-]` (generated ones are 7-9 characters without look-alike letters); tags are 1-32 characters.

### Record shape (`qr:v1:code:{id}`)

JSON validated by `qrRecordSchema` (`src/lib/schema.ts`): `v`, `id`, `opId?`, `name`, `description`, `type`, `mode` (`static`/`dynamic`), `fields`, `payload`, `slug`, `style`, `tags`, `folder`, `favorite`, `pinned`, `status` (`active`/`archived`/`trashed`), `enabled`, `schedule` (`activateAt`, `expiresAt`, `expireAfterSeconds`), `scanLimit`, `password` (`{hash, setAt}` or null), `afterExpiry`, `analytics`, `rev`, `createdAt`, `updatedAt`. A sealed record replaces `payload` with `"sealed"`, `fields` with `{}` and adds `sealed` (base64 `iv | tag | ciphertext`, AAD = id).

## Size estimates and capacity (30 MB)

Measured with the real schema: a typical dynamic URL record is **about 1.0 KB** of JSON (the style object dominates). Add the slug key, count key, sorted-set and set entries, and Redis per-key overhead: **about 1.3-1.5 KB per code** all-in. The numbers below are estimates, not measurements of a live database.

| Item | Approximate cost |
| --- | --- |
| Code (record + slug + count + index entries) | 1.3-1.5 KB |
| Folder / template | 0.2 KB / about 0.8 KB |
| Logo asset | up to about 16 KB (12 KB decoded, stored as base64 data URL), shared by identical images |
| One stats hash (code x day) | about 0.25 KB |
| `stats:all` for a day | grows by one `k:` field (about 30 B) per code scanned that day |
| `recent` list | about 100 entries x 50 B = 5 KB |
| Rate-limit keys | tens of bytes each, expire in <= 2 h |

Examples for a 30 MB database *if QR Studio had it to itself*:

| Scenario | Estimate |
| --- | --- |
| 500 codes, no traffic | about 0.75 MB |
| 10,000 codes (`MAX_CODES`, the hard limit) | about 15 MB |
| 100 codes each scanned daily, 90-day retention | about 2.3 MB of stats + 0.3 MB in `stats:all` |
| 1,000 codes each scanned daily, 365-day retention | about 90 MB of stats: **does not fit** |
| 50 distinct logos | about 0.8 MB |

Analytics retention, not code count, is what fills the database. The memory is shared with the research site and Redis itself reserves some. The app reads `used_memory` / `maxmemory` from `INFO memory` and shows a warning at 80 % (Settings and a banner). Levers: lower retention (existing keys keep their old TTL until their next scan), reset analytics, turn analytics off per code or globally, purge trashed codes, run repair (drops orphan logos).

## Lua scripts

Defined in `src/lib/redis/scripts.ts`, loaded with `SCRIPT LOAD`, called with `EVALSHA`, with a fallback to `EVAL` when Redis answers `NOSCRIPT` (for example after a restart). Redis executes each script atomically.

| Script | What it does | Guarantees |
| --- | --- | --- |
| `PUT` | `create` or `update` of a record: checks existence (create) or `rev == expectedRev` (update), checks the slug owner, then writes slug mapping, `index:codes`, folder/tag sets and the record together. Returns `OK`, `EXISTS`, `MISSING`, `REV`, or `SLUG`. | Slug uniqueness (check-and-claim in one step); optimistic concurrency (no lost update); indexes never disagree with the record they describe. |
| `PURGE` | Removes the record, its slug, folder and tag membership, index entry and counter. | Permanent delete leaves no dangling index entries. |
| `RESOLVE` | `GET slug -> id`, `GET code`, `GET count`, `GET settings`, in one call. | The public hot path costs one round trip for reading. |
| `ACCEPT` | If a scan limit is set and reached returns -1 without changing anything; otherwise `INCR`s the counter (when a limit or analytics applies) and updates the day hashes, the global hash, `recent` and TTLs. | Race-free scan limits: with limit N exactly N concurrent scans are accepted. Analytics and counter move together. |
| `HIT` | `INCR` a rate-limit key and set its expiry on first use. | Atomic fixed-window counter; no key without a TTL. |

The scripts build some key names from `ARGV[1]` (the prefix) instead of declaring them in `KEYS`. That is fine on a single node (Redis Cloud Free). Redis Cluster would require declaring all keys and giving them a common hash tag. `runScript` additionally verifies that every declared key starts with the namespace prefix (`assertOwnKey`).

## Index consistency and repair

`PUT` and `PURGE` maintain all derived structures in the same atomic step, so normal operation cannot make them diverge. They can still diverge through operations that are *not* atomic across keys: folder deletion and tag rename/merge (loop over `updateCode`, then a `MULTI`), restore and import (many writes), or through manual tampering and partial data loss.

The repair tool (`POST /api/admin/repair`, Settings -> Index maintenance) rebuilds from the canonical `code:*` records:

- dry run by default (`apply: false`); reports corrupt records, codes missing from the index, stale index entries, slug fixes and **slug conflicts** (the oldest record by `createdAt` keeps the slug), folder/tag set fixes and orphan logos;
- with `apply: true` it rewrites `index:codes`, slug mappings, folder/tag sets and `index:tags`, and deletes logos not referenced by any code, template or default style;
- bounded: at most 50,000 keys per `SCAN`, 10,000 codes;
- it never deletes a code, and it touches only `qr:v1:` keys.

The library list, backups and the public resolver depend on the indexes (`index:codes`, `slug:*`). A code missing from `index:codes` is invisible in the library and absent from snapshots until repaired.

## Analytics retention

Day buckets are UTC. TTL is `(retentionDays + 1)` days, set on every accepted scan, with `retentionDays` from Settings (7-365, default 90). Counters (`count:{id}`) and the `recent` list do not expire. Resetting analytics (`POST /api/analytics/reset`) deletes `stats:*` (or one code's), the matching `count:*` (**which resets scan limits**) and `recent`, with bounded `SCAN`+`UNLINK`.

## Commands never used

`FLUSHDB`, `FLUSHALL`, `KEYS`. Also no `CONFIG`, `DEBUG`, `SHUTDOWN`, pub/sub or blocking commands. The commands the app does use are listed in [SETUP.md](./SETUP.md#7-using-the-existing-redis-cloud-database).

### SCAN usage and bounds

| Where | Pattern | Bound |
| --- | --- | --- |
| Repair (`scanKeys`) | `qr:v1:code:*`, `slug:*`, `index:folder:*`, `index:tag:*`, `asset:*` | `COUNT 500` per step, stops after 50,000 keys |
| Backup (`stats:*`) | `qr:v1:stats:*` | stops after 20,000 keys (further keys are silently not backed up) |
| Analytics reset | `qr:v1:stats:*`, `qr:v1:count:*` (or one code's) | `COUNT 500`, at most 200 rounds, deleted with `UNLINK` |
| Listing codes | not a scan: `ZRANGE index:codes 0 9999` + `MGET` in chunks of 400 | 10,000 codes |

Every key returned by a scan passes `assertOwnKey` before it is deleted or restored.

## Connection handling

`src/lib/redis/client.ts`:

- **Singleton** per function instance (kept on `globalThis` across hot reloads); concurrent callers share one in-flight connect.
- **Fail fast:** `connectTimeout` 3 s, `reconnectStrategy: false`, `disableOfflineQueue: true`, TCP keep-alive. A dead socket makes the next call reconnect lazily rather than queueing commands.
- **Per-operation timeout** 5 s (`Promise.race`; the socket is destroyed on timeout and the timer is cleared).
- **No automatic write replay:** on connection-class errors the client is destroyed and the operation fails as HTTP 503. The next request reconnects. A timed-out command may already have committed; blindly retrying would double-count scans. Client creates carry stable ids/opIds for safe retry.
- Errors are never logged with their message (it can contain the URL).

The free tier allows roughly 30 simultaneous connections for the whole database (per the code comment); one per warm function instance, plus the research site's, must stay below that.

## Schema versioning and migrations

- `SCHEMA_VERSION = 1` (`schema.ts`). Every record has `v`; settings have `v: 1`; the sentinel stores `schemaVersion`; snapshots store it too.
- `migrateRecord` (`migrate.ts`) upgrades one version at a time from `steps[v]`. It currently has no steps. A record **newer** than the build is rejected, never guessed at; a missing `v` is treated as 1.
- To change the record shape: bump `SCHEMA_VERSION`, add a step that upgrades `v` by one, and deploy. Records are migrated on read and written back at the new version on their next update. Old builds will refuse the new records (rollbacks across a bump fail loudly). Snapshots written by an older build restore fine; snapshots from a newer build are refused.
- The `v1` in the key prefix is the *namespace* version, independent of the record version. A change that cannot coexist with the old data would move to `qr:v2:` together with a copy job.

## Namespace isolation from the research site

- All keys start with `qr:v1:`; the research site's `link:`, `meta:`, `tag:`, `collection:` keys never start with it.
- No unprefixed access exists in the code: `K.*` builders are the only key constructors, `assertOwnKey` guards every bulk delete/restore/script key, scans use `MATCH qr:v1:...`.
- Test suites can override the prefix only when `NODE_ENV=test` (`QR_KEY_PREFIX`).
- What is shared and therefore *not* isolated: memory budget, connection limit, availability, and the logical database (the URL path selects it; both sites use whatever the URL says, typically `0`).

## Redis Cloud Free limitations and mitigations

| Limitation | Consequence | Mitigation in the app / what you do |
| --- | --- | --- |
| No TLS | Traffic readable and alterable on the path | Wi-Fi/vCard sealing, hashed link passwords, encrypted backups, UI warning. Real fix: TLS-capable plan. |
| No durability or provider backups (as understood for this plan; check the console) | Restart or reset can wipe everything | Sentinel key + recovery screen, daily encrypted GitHub snapshots, restore UI and CLI. Residual: up to a day of changes. |
| 30 MB memory, shared | Writes rejected when full (assuming a no-eviction policy; the app does not set or check it) | Usage banner at 80 %, retention limits, `MAX_CODES`, 12 KB logos, reset/repair tools. The public redirect path also writes (counters), so a full database breaks links that use analytics or scan limits (fail-closed 503). |
| About 30 connections | Connection errors under many concurrent instances | One connection per instance, no pub/sub, fail-fast, lazy reconnect without ambiguous mutation replay. |
| Shared with another site | Their usage and mistakes affect you | Disjoint prefix; separate backups; watch the shared usage figure. |
| Inactivity deletion (policy may apply; confirm in Redis Cloud docs) | Whole database removed | Keep it used; the daily cron job touches Redis incidentally (not a designed keep-alive); backups restore the data. |
| Single node, no replicas | No failover | Resolver fails closed with 503; recover by restore. |
| Throughput and ops limits (plan-specific) | Throttling under a scan spike | Two Redis calls per accepted scan; a page of unknown-slug hits is rate limited per visitor. |
| Latency to the Redis region | Slower requests | Pick the Vercel function region next to Redis ([DEPLOYMENT.md](./DEPLOYMENT.md#6-function-region)). |

## Migration path

### Same code, a better Redis (smallest change)

1. Provision a Redis with TLS and persistence/backups (any provider supporting Lua scripting and the commands in [SETUP.md](./SETUP.md#7-using-the-existing-redis-cloud-database)).
2. Press **Back up now**; keep the key.
3. Restore into the new database: `bun run restore --github= --redis-url 'rediss://...' --apply --yes`.
4. Set `REDIS_URL` to the `rediss://` URL in Vercel and redeploy. The app reports `tls: true` automatically when the URL starts with `rediss://`, and the warning disappears.
5. Verify, keep the old database until the new one has run a backup cycle, then delete the old one.

### Another durable datastore (for example Postgres)

`src/lib/redis/repo.ts` is the persistence boundary, but it is a set of exported functions rather than a declared TypeScript interface, and some code talks to Redis directly: `maintenance.ts` (scan-based repair, import/restore upserts), `backup/snapshot.ts` (collect/restore use `withRedis` for sets, hashes and TTLs), `server-status.ts` via `health()`, `scripts/restore.ts`. A port means re-implementing all of those.

What depends on Lua, and the equivalent:

| Redis mechanism | Postgres equivalent |
| --- | --- |
| `PUT` (CAS on `rev`, slug claim, index maintenance) | One transaction; `UPDATE ... WHERE id=$1 AND rev=$2`; `UNIQUE(slug)`; folders/tags as columns or join tables (indexes become real indexes) |
| `PURGE` | `DELETE ... CASCADE` |
| `RESOLVE` (slug -> record + count + settings) | One query/join |
| `ACCEPT` (limit check + increment + stats) | `UPDATE codes SET scans = scans + 1 WHERE id=$1 AND (limit IS NULL OR scans < limit) RETURNING scans`, plus an upsert into a daily stats table in the same transaction |
| `HIT` (rate limit) | Upsert on `(bucket, window)` with a cleanup job, or a separate cache |
| TTL-based analytics expiry | `DELETE ... WHERE day < now() - retention` job |
| `SCAN`-based repair | Largely unnecessary (constraints replace it) |
| Sentinel `meta:schema` | Still useful to detect an empty database after a wipe |

The snapshot format is store-agnostic at the record level (raw record JSON, folders, templates, settings, assets, counters, stats), so existing snapshots can seed a new store through a new restore implementation.
