# Backup and restore

Redis Cloud Free has no durability guarantee and no backups of its own. QR Studio therefore writes encrypted snapshots of its data to a private GitHub repository and can restore them from the web UI or a command-line tool. This document describes exactly what the code does.

**Snapshots do not eliminate data loss.** Anything created or changed after the newest snapshot is gone if Redis is wiped. The design shrinks the window to roughly a day, it does not close it.

## Design

| Aspect | Behaviour (source) |
| --- | --- |
| Where | Private GitHub repo `BACKUP_GITHUB_REPO`, branch `BACKUP_GITHUB_BRANCH` (default `main`), folder `snapshots/`, written through the Contents API with a fine-grained token (`src/lib/backup/github.ts`). |
| File name | `qr-<YYYYMMDDTHHMMSSZ>-<hash8>.qrbackup.json`. `hash8` = first 8 hex chars of a timestamp-free content hash; names sort chronologically. |
| Format | JSON envelope `{ format: "qr-studio-backup", version: 1, alg: "A256GCM+gzip", createdAt, schemaVersion, recordCount, contentSha256, data }`. `data` = base64 of `iv(12) | auth tag(16) | ciphertext`, where the plaintext is the gzip-compressed snapshot JSON. |
| Encryption | AES-256-GCM, key `BACKUP_ENCRYPTION_KEY` (32 bytes, base64). Fresh random IV per file. |
| Header authentication | The envelope header is the GCM **AAD**: `qr-studio-backup|1|createdAt|schemaVersion|recordCount|contentSha256`. Editing the date, count, version or checksum makes decryption fail. |
| Checksum | `contentSha256` is the SHA-256 of the exact plaintext; verified after decryption ("Checksum mismatch: backup contents are corrupted"). Record count must also match the header. |
| Version gate | A snapshot with a `schemaVersion` newer than the running build is refused. |

### What a snapshot contains

- `meta`: the initialisation sentinel (`schemaVersion`, `initializedAt`, `instanceId`).
- `codes`: the **raw stored JSON** of every record in the code index, including trashed and archived ones. Sealed Wi-Fi/vCard blobs stay sealed (the snapshot never needs `DATA_ENCRYPTION_KEY`). The **link password hashes are part of each record and are included**.
- `folders`, `templates`, `settings`.
- `assets`: only logo images referenced by a code, a template or the default style.
- `counts`: lifetime scan counter per code.
- `stats`: per-day analytics hashes (`stats:<code>:<day>` and `stats:all:<day>`) with the TTL they had when the snapshot was taken. At most 20,000 stats keys are scanned.

### What is not in a snapshot

- Derived structures: the code index, slug map, folder and tag sets. They are rebuilt by the write script during restore.
- Rate-limit buckets, the "recent activity" list, backup status/lock keys.
- Orphaned logo images and analytics of deleted codes.
- Records that fail to parse (reported as "N unreadable record(s) were not included" in the run) and records missing from the code index. Snapshots are index-driven; if you suspect index damage run Settings -> Index maintenance -> Verify/Repair first.

### Run logic (`runBackup`)

1. **Configured?** Needs repo, token and `BACKUP_ENCRYPTION_KEY`; otherwise the run is recorded as failed.
2. **Lock.** `SET qr:v1:backup:lock NX EX 300`. If held, the run returns `skipped: Another backup is already running` (not recorded in history).
3. **Skip-when-uninitialised.** If `qr:v1:meta:schema` is missing, the run is `skipped` and nothing is uploaded. This stops a wiped database from becoming "the latest snapshot" and, with retention, eventually displacing good history. It does not count as a success.
4. **Collect, pack, hash.** The content hash covers the whole snapshot except `createdAt`.
5. **Unchanged-skip.** If the newest remote snapshot's `hash8` matches, it is downloaded, decrypted with the current key, integrity-checked, and compared using the full content hash. Only verified identical content avoids an upload (`outcome: "unchanged"`, which counts as a success). Because counters and analytics values are part of the snapshot, any accepted scan changes the hash (the countdown of analytics TTLs is excluded); an idle library with no traffic produces no new files. A rotated key or corrupt remote snapshot triggers a fresh snapshot. Upload contents are downloaded and compared before pruning or recording success.
6. **Upload** with `PUT contents/snapshots/<name>`.
7. **Prune** (only after a successful upload), see below.
8. **Record** the outcome in `qr:v1:backup:status` (last 30 runs) and release the lock.

`runBackup` never throws; every outcome is recorded when Redis remains writable. Before remote I/O it records an unfinished-attempt entry; successful completion replaces that entry, while a killed function leaves a visible failure. Status cannot survive a total Redis loss; GitHub remains the independent recovery source. Unreadable records make the run fail before upload or retention pruning, preserving good history.

### Retention

Implemented in `planPrune`:

- Keep the **newest 30** snapshots, **plus** the newest snapshot of each of the **12 most recent calendar months** that have at least one snapshot.
- Everything else is pruned, oldest first, at most **25 deletions per run**. If a deletion fails, pruning stops for that run and the extra files simply stay.
- Pruning deletes files from the branch tip only. **Git history keeps pruned snapshots**, so they remain readable with the key to anyone with repository access.

In practice: roughly a month of near-daily snapshots, then one per month for a year.

## Status and freshness

- Status lives in `qr:v1:backup:status`: last success, last attempt, and the last 30 runs (time, trigger `cron`/`manual`, outcome `created`/`unchanged`/`failed`/`skipped`, file name, record count, bytes, pruned count, error).
- Freshness (`freshness()`): `unconfigured`, `never`, `ok`, or `stale` when the last success is **older than 36 hours**. Settings uses the later of the recorded last success and the newest snapshot's timestamp on GitHub.
- The app shell warns when backups are unconfigured or stale; Settings -> Backup shows history and the snapshot list.

## Running backups

- **Cron:** `GET /api/cron/backup` daily at 03:17 UTC, authenticated with `CRON_SECRET` ([DEPLOYMENT.md](./DEPLOYMENT.md#3-cron-daily-backup)). Returns 500 when the run failed.
- **Manual:** Settings -> Backup -> **Back up now** (`POST /api/backup`, limited to 3 per minute).
- **Encrypted download:** Settings -> Backup -> **Download encrypted export** (`GET /api/backup/download`) gives you a `qr-studio-YYYY-MM-DD.qrbackup.json` in the same format. No plaintext dump of the database exists. Store it somewhere other than GitHub for a second copy. The download needs `BACKUP_ENCRYPTION_KEY` and an initialised library.
- **GitHub failures:** network errors and 5xx responses are retried up to three attempts (0.5 s, 1 s back-off), each request has a 25 s timeout. A 403/429 with an exhausted rate limit is not retried; the run fails with "GitHub rate limit reached (retry in N s)". 401/403/404 produce hints in the history row ("token invalid or expired", "token lacks Contents write access", "repository, branch or path not found"). A failed run does not retry on its own until the next cron or manual run.

## Restore from the UI

Settings -> Backup -> pick a snapshot from the GitHub list (or upload a `.qrbackup.json`), then:

1. **Mode**
   - **Merge** (default): adds and updates; never deletes anything.
   - **Replace**: additionally deletes codes, folders and templates that are not in the snapshot. Applying requires typing `replace` (UI and API both enforce it).
2. **If a code exists in both and differs** (`prefer`):
   - **newer** (default): the copy with the later `updatedAt` wins (snapshot wins ties).
   - **snapshot**: the snapshot always wins.
   - **existing**: the current copy is kept.
3. **Dry run** (default, writes nothing). The report lists how many codes would be created, updated, left unchanged or kept, how many have slug conflicts or are invalid, and individual conflicts. The UI only enables **Apply** for a dry run made with the current options. Restore calls are limited to 6 per minute.
4. **Apply.**

Conflict handling in detail (`restoreSnapshot`):

- Matching is by record id. Identical record content (ignoring the local revision counter) -> unchanged.
- A snapshot record whose slug already belongs to a *different* code is skipped and reported as a slug conflict.
- Folders and templates are always upserted from the snapshot (they are not subject to `prefer`).
- Logo assets are added if missing; scan counters take the maximum of existing and snapshot values atomically; stats TTLs subtract elapsed time since the snapshot, and expired buckets are skipped.
- Settings are overwritten in replace mode, with `prefer=snapshot`, or when no settings exist yet.
- Records, settings, counters, logo hashes and stats keys are validated before the first write. Merge can salvage valid records and reports invalid rows. Replace refuses any invalid or duplicate records before deleting or writing anything. A write-time conflict aborts with an explicit partial-restore error before deletion; rerun after reviewing the library.
- Applying is idempotent: if it is interrupted, run it again. The initialisation sentinel is created **last**, so only a completed restore marks the library initialised.

A restore into an uninitialised database never needs `DATA_ENCRYPTION_KEY`; sealed records are copied as opaque blobs. You do need that key afterwards to *read* them.

## Restore CLI

For when the web app cannot be used (no deployment, no Redis access from Vercel, large files). It runs on your machine, talks to Redis directly and never touches keys outside `qr:v1:`.

```bash
bun run restore --list
bun run restore --github                               # dry run of the NEWEST snapshot
bun run restore --github --name qr-20261108T031700Z-ab12cd34.qrbackup.json
bun run restore --github --apply --yes               # apply newest to the target Redis
bun run restore --file ./qr-studio-2026-11-08.qrbackup.json --mode replace --prefer snapshot --apply --yes
bun run restore --file ./export.qrbackup.json --redis-url redis://localhost:6390 --apply   # local drill, no --yes needed
```

| Flag | Meaning |
| --- | --- |
| `--list` | List snapshots in the GitHub repo and exit. |
| `--github` / `--name <snapshot>` | Source: a snapshot from GitHub. Without `--name` the newest is used. |
| `--file <path>` | Source: a local encrypted file (e.g. the download from Settings). |
| `--mode merge\|replace` | Default `merge`. |
| `--prefer newer\|snapshot\|existing` | Default `newer`. |
| `--apply` | Actually write. Without it the command is a **dry run**. |
| `--yes` | Required together with `--apply` when the target Redis is not local (`localhost`, `127.0.0.1`, `::1`) or the mode is `replace`. |
| `--redis-url <url>` | Overrides `REDIS_URL`. |
| `--help` | Print usage. |

Environment: `REDIS_URL`, `BACKUP_ENCRYPTION_KEY`, and for `--github`: `BACKUP_GITHUB_REPO`, `BACKUP_GITHUB_TOKEN` (`BACKUP_GITHUB_BRANCH`). `.env.local` then `.env` in the current directory are loaded; variables already present in the shell take precedence, which is how you supply an *old* backup key for an old snapshot:

```bash
BACKUP_ENCRYPTION_KEY='<old key>' bun run restore --github --name qr-2026....qrbackup.json
```

The CLI prints the verified snapshot header, the target host, the namespace and whether the library marker exists, then the dry-run or applied report. Restore Bun requirement: see [SETUP.md](./SETUP.md#1-prerequisites).

## Total-loss recovery runbook

**Symptoms.** Signing in shows **Library not initialised**; dynamic links answer "Temporarily unavailable" (HTTP 503 with `Retry-After`) instead of 404; `/api/health` is still `{"ok":true}`; saving is refused with `RECOVERY_REQUIRED`. This means Redis answers but `qr:v1:meta:schema` does not exist: either it is a first run, or the database lost its data (reset, plan change, inactivity removal, a flush by another tenant of the same database).

1. **Do not click "Start with an empty library" yet.** That is the one irreversible choice: new work would start on top of nothing, and the next daily backup would capture the empty state as the latest snapshot.
2. **Confirm you are looking at the right database.** An old or wrong `REDIS_URL` pointing at a different, empty database looks identical. Check the Redis Cloud console and the Vercel variable.
3. **Check the backup configuration is present** (`BACKUP_GITHUB_*`, `BACKUP_ENCRYPTION_KEY`). The Recovery screen lists the newest snapshot in GitHub if they are.
4. **Restore**, choosing one:
   - **Restore the latest backup** (Recovery screen). Review the dry-run report, then **Restore now** (merge, prefer newer).
   - **Encrypted backup file**: upload a `.qrbackup.json` you downloaded earlier.
   - **CLI** against the production Redis (`bun run restore --github --apply --yes`) if the UI path fails, or for files too large for Vercel's request limit.
   - **Rebuild from this device's cache**: uses the library cached in this browser's IndexedDB. Last resort: it contains no link passwords, folders, templates or analytics, and the older the cache the staler the data.
   - **Start with an empty library**: only if you accept the loss. Printed dynamic QR codes will say "not found".
5. **Verify.** Library counts look right; open a few codes; open a printed/dynamic link in a private window; Settings -> Index maintenance -> **Verify** reports no problems; Settings -> Data shows Redis healthy.
6. **Re-establish protection.** Press **Back up now**. If you restored from the device cache or a JSON import, **re-set the password** on every protected link: those paths do not restore them.
7. **Find out why** the data was lost, and where else the same cause applies (the research site shares the database).

### What is not recovered

- Everything created or changed after the snapshot you restored.
- Scan counts after the snapshot. Counters return to their snapshot values, so a link with a scan limit can accept scans it already accepted before the loss.
- The "recent activity" list; rate-limit state.
- Analytics older than the retention window (elapsed time since snapshot creation is deducted from their saved TTLs, so nothing is extended).
- Records that were unreadable or absent from the index at snapshot time.
- Link passwords are **not lost** when restoring from a snapshot (the scrypt hashes are inside the record JSON that is backed up and written back). They are lost when restoring from the library JSON export/import or from the device cache, which both deliberately drop password hashes.
- Wi-Fi/vCard codes come back sealed under the key that sealed them. Without that `DATA_ENCRYPTION_KEY` they stay unreadable.

## Test your backups

A backup you have never restored is a hope, not a backup.

- Monthly: Settings -> Backup -> pick the newest snapshot -> **Dry run**. It proves the file exists, decrypts and passes the checksum.
- Quarterly: full drill into a throw-away Redis:
  ```bash
  bun run redis:test
  bun run restore --github --redis-url redis://localhost:6390 --apply
  # point .env.local at redis://localhost:6390, run `bun run dev`, check the library
  docker stop qr-test-redis
  ```
- After any key rotation or token change, run a manual backup and dry-run restore it.

## Key loss

- Lose `BACKUP_ENCRYPTION_KEY`: every snapshot, and every downloaded export, is permanently unreadable. There is no recovery path or escrow.
- Lose `DATA_ENCRYPTION_KEY`: Wi-Fi and vCard records are permanently unreadable, in Redis and in all snapshots. Everything else is unaffected.
- Keep both in a password manager that does not depend on Vercel, GitHub or the machine you develop on. When rotating, keep the old key until the last snapshot encrypted with it has aged out of retention.

## Known issues in the restore tooling

- In `replace` mode against a Redis that has code records but no initialisation sentinel, the deletion step calls `purgeCode`, which requires the sentinel; the sentinel is created only at the end. A plain total-loss restore (empty database) is unaffected. If you hit "Library not initialised" during such a replace, run the restore in merge mode first, then replace.

Recovery is not a cross-library transaction. Quiesce owner edits during restore/index repair. Individual code writes and slug claims are atomic; an interruption can leave a partial library, reported as such. Merge retries can complete recovery. Lua scripts are atomic with respect to other commands, but Redis does not roll back earlier writes if a script fails at runtime (for example on a wrong-type key or a full shared instance). Verify and repair indexes after recovery.
