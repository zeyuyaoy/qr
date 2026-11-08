# Deployment (Vercel)

Instructions for deploying QR Studio to Vercel Hobby at `https://qr.zeyuyaoy.com`. This document does not assert that a deployment exists or works; use the [verification checklist](#post-deploy-verification-checklist) to confirm it yourself.

Prerequisites: finish [SETUP.md](./SETUP.md) sections 4, 5, 7 and 8 first (secrets, Google OAuth client, Redis URL, backup repo).

## 1. Create the Vercel project

1. Vercel dashboard -> **Add New -> Project** -> import the GitHub repository `zeyuyaoy/qr`.
2. **Framework preset:** Next.js (also pinned by `vercel.json`). Install and build commands are pinned in `vercel.json`; leave the output directory at its default.
3. **Bun runtime:** `vercel.json` sets `"bunVersion": "1.x"` for Functions and routing middleware. Vercel manages minor/patch versions; this runtime is currently beta. See [Vercel Bun runtime](https://vercel.com/docs/functions/runtimes/bun).
4. Add the environment variables (next section) **before** the first deploy. `NEXT_PUBLIC_APP_URL` is inlined into the client bundle at build time, so a missing or wrong value requires a rebuild, not just a restart.
5. Deploy.

## 2. Environment variables

Set these in Project Settings -> Environment Variables. Scope = which Vercel environments should get the value.

| Name | Required | Scope | Description | Example placeholder |
| --- | --- | --- | --- | --- |
| `REDIS_URL` | yes | Production only | Redis connection string. `redis://` (no TLS on the free tier). Same value as the research site's `RESEARCH_REDIS_URL` is fine. | `redis://default:<password>@<host>:<port>` |
| `NEXT_PUBLIC_APP_URL` | yes | Production (build-time) | Public origin, no trailing slash. Encoded into dynamic QR codes. | `https://qr.zeyuyaoy.com` |
| `AUTH_SECRET` | yes | Production | Session encryption + keyed hashing of rate-limit buckets. | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | yes | Production | Google OAuth client ID. | `123-abc.apps.googleusercontent.com` |
| `AUTH_GOOGLE_SECRET` | yes | Production | Google OAuth client secret. | `GOCSPX-...` |
| `OWNER_EMAILS` | yes | Production | Comma-separated allowed sign-in emails. | `you@example.com` |
| `DATA_ENCRYPTION_KEY` | for Wi-Fi/vCard on the server | Production | 32-byte base64; seals Wi-Fi and vCard records. | `openssl rand -base64 32` |
| `BACKUP_ENCRYPTION_KEY` | for backups | Production | 32-byte base64, independent of the data key. | `openssl rand -base64 32` |
| `CRON_SECRET` | for backups | Production | Bearer token Vercel Cron sends to `/api/cron/backup`. | `openssl rand -hex 32` |
| `BACKUP_GITHUB_REPO` | for backups | Production | `owner/name` of the private snapshot repo. | `you/qr-studio-backups` |
| `BACKUP_GITHUB_TOKEN` | for backups | Production | Fine-grained PAT, Contents read/write on that repo only. | `github_pat_...` |
| `BACKUP_GITHUB_BRANCH` | no | Production | Target branch (default `main`). | `main` |
| `ENABLE_TEST_AUTH`, `TEST_AUTH_SECRET` | **never** | none | Test-only. Do not create them in Vercel. | - |
| `QR_KEY_PREFIX` | **never** | none | Only honoured when `NODE_ENV=test`. | - |

Why "Production only" for the secrets: a Preview deployment that received `REDIS_URL` could read and write your production data, and previews cannot sign in anyway (their URL is not an authorised Google redirect URI). If you want working previews, give them a separate Redis database and OAuth client.

Vercel supplies `VERCEL`, `VERCEL_ENV` and `NODE_ENV` itself. The app uses them to trust geo headers (`VERCEL=1`), to disable test auth in production (`VERCEL_ENV=production`) and to relax CSP only in development.

Without Redis variables the app builds and starts, but `/api/health` returns 503 and every page that needs data shows an error banner.

## 3. Cron: daily backup

`vercel.json` registers one job:

```json
{ "crons": [{ "path": "/api/cron/backup", "schedule": "17 3 * * *" }] }
```

- Runs daily at 03:17 UTC against the **production** deployment.
- Hobby plans allow cron jobs at most once per day. Vercel documents that on Hobby the invocation can land anywhere within the scheduled hour (check Vercel's current cron docs); the app's 36-hour staleness threshold absorbs that jitter.
- Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when a `CRON_SECRET` variable exists in the project. The route compares it in constant time (`requireCron`). No secret configured -> `501 NOT_CONFIGURED` (never open); wrong secret -> `401 UNAUTHENTICATED`.
- The route returns HTTP 500 when the backup run fails, so failures appear as failed invocations in Vercel's cron log. Details: [BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md).
- After adding or changing `CRON_SECRET`, redeploy; the value is read at request time but cron registration happens per deployment.

You can trigger the same code manually from Settings -> Backup -> **Back up now**.

## 4. Custom domain `qr.zeyuyaoy.com`

1. Project Settings -> **Domains** -> add `qr.zeyuyaoy.com`.
2. Vercel then shows the exact DNS record to create at your DNS provider. **Copy what Vercel displays.** For a subdomain this is normally a `CNAME` for `qr` pointing at a Vercel target (often `cname.vercel-dns.com`, or a project-specific value); do not guess it.
3. Wait for the domain to show as valid. Vercel issues the TLS certificate automatically; the site is HTTPS-only (HSTS is sent by the app, and `upgrade-insecure-requests` is added in CSP on Vercel).
4. Decide on the production URL once and keep it: it is printed inside every dynamic QR code ever created. Changing the domain later breaks printed codes unless the old domain keeps redirecting to the same paths.

Then set `NEXT_PUBLIC_APP_URL=https://qr.zeyuyaoy.com` (if not already) and redeploy.

## 5. Google OAuth for production

In Google Cloud Console -> Credentials -> your OAuth client -> Authorized redirect URIs, make sure this exact URI is present:

```
https://qr.zeyuyaoy.com/api/auth/callback/google
```

(`http://localhost:3000/api/auth/callback/google` can stay for local development.) See [SETUP.md](./SETUP.md#5-create-the-google-oauth-client).

## 6. Function region

Every request that needs data makes several Redis round trips, so latency to Redis dominates. Pick the Vercel Function Region closest to the Redis Cloud region of your database: Project Settings -> **Functions** -> Function Region. Check the Redis region in the Redis Cloud console. The default region may not be the right one. Region changes apply to the next deployment.

## Post-deploy verification checklist

Run these after the first deploy and after any change to env vars, domain or `vercel.json`. Substitute your host.

- [ ] **Private routes redirect.** Signed out, `curl -sI https://qr.zeyuyaoy.com/library` returns a redirect to `/login`. Same for `/`, `/settings`, `/analytics`, `/scan`.
- [ ] **Private API refuses.** `curl -s https://qr.zeyuyaoy.com/api/codes` returns `401` with `{"ok":false,"error":{"code":"UNAUTHENTICATED",...}}`.
- [ ] **Health.** `curl -s https://qr.zeyuyaoy.com/api/health` returns `{"ok":true}` (HTTP 200). `503` means Redis is unreachable.
- [ ] **Cron is closed.** `curl -si https://qr.zeyuyaoy.com/api/cron/backup` returns `401`.
- [ ] **Sign-in works** with an `OWNER_EMAILS` account; a different Google account lands on the login page with "That Google account is not allowed".
- [ ] **Initialise.** On a fresh database the first screen is "Library not initialised": choose **Start with an empty library**. (If you restored from backup, this is skipped.)
- [ ] **Dynamic link works signed out.** Create a dynamic URL code, copy its short link, open it in a private window or `curl -sI https://qr.zeyuyaoy.com/r/<slug>`: expect `307` with `Location:` set to your destination. Pause the code and confirm the page changes to "Link paused".
- [ ] **PWA files.** `/manifest.webmanifest` returns JSON; `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/maskable-512.png` return 200; `/sw.js` returns 200 with `Cache-Control: no-cache, no-store, must-revalidate`. Chrome DevTools -> Application -> Manifest shows installable.
- [ ] **Security headers.** `curl -sI https://qr.zeyuyaoy.com/login` shows `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, and no `X-Powered-By`.
- [ ] **Backup run.** Settings -> Backup -> **Back up now** succeeds ("Backup created"); a `snapshots/qr-*.qrbackup.json` file appears in the GitHub repo.
- [ ] **Status page.** Settings shows "Backups are up to date" and the Redis storage figures. The red "not protected" banner is gone.
- [ ] **Redis TLS warning.** Settings -> Data still shows the "traffic is not encrypted" warning: expected on the free tier.
- [ ] **Dry-run restore.** Settings -> Backup -> restore the snapshot you just made in **dry run** mode and check the counts. A backup you have never restored is unproven.

## Rollback

- **Bad deploy:** Vercel -> Deployments -> pick the last good one -> **Promote to Production** (or "Instant Rollback"). Data in Redis is not touched by a rollback.
- **Schema changes:** records carry a version (`v`); a build refuses records newer than itself rather than guessing (`migrateRecord`). Rolling back across a schema bump therefore fails loudly. No schema bump has happened yet (`SCHEMA_VERSION = 1`).
- **Env var mistakes:** fix the variable and redeploy; changing a variable does not affect running deployments.

## Rotating secrets

| Secret | Effect of rotating | Safe procedure |
| --- | --- | --- |
| `AUTH_SECRET` | Everyone is signed out; rate-limit visitor hashes change (limits reset). | Replace in Vercel, redeploy, sign in again. |
| `AUTH_GOOGLE_SECRET` | Sign-in fails until updated. | Google Console: create a new client secret, update Vercel, redeploy, then disable the old secret. |
| `OWNER_EMAILS` | Takes effect at the next request after redeploy; removed addresses are refused by the API (`requireOwner` re-checks the live list). | Edit, redeploy. |
| `CRON_SECRET` | Cron gets `401` until Vercel redeploys with the new value. | Replace, redeploy, confirm the next cron run (or call the route yourself with `curl -H "Authorization: Bearer <new>"`). |
| `BACKUP_GITHUB_TOKEN` | Backups fail with 401 until updated. | Create the new token, update Vercel, redeploy, run **Back up now**, then revoke the old token. |
| Redis password | App and research site both lose access. | Change it in Redis Cloud, update `REDIS_URL` here **and** in the research site's variable, redeploy both. |
| `DATA_ENCRYPTION_KEY` | **Existing sealed Wi-Fi/vCard records become unreadable.** They are encrypted with no key id, so the app cannot read a record with a key other than the one that sealed it. Records stay in Redis (listed as "unreadable") and are not deleted. | See below. |
| `BACKUP_ENCRYPTION_KEY` | **Older snapshots can no longer be opened with the new key.** | See below. |

### Rotating `DATA_ENCRYPTION_KEY`

There is no built-in re-keying tool. If you hold no Wi-Fi or vCard codes on the server, just change the key. Otherwise re-seal them through export and import:

1. While the **old** key is still deployed: Library -> Manage -> Export JSON (backup). This file contains Wi-Fi passwords and contact data in clear text; treat it as a secret and delete it afterwards.
2. Reduce the file to the sensitive records only. Importing with "overwrite" replaces records by id and sets link passwords to none, so the file must not contain your dynamic codes:
   ```bash
   jq '.codes |= map(select(.type=="wifi" or .type=="vcard")) | .folders=[] | .templates=[]' qr-library-DATE.json > sensitive.json
   ```
3. Set the new `DATA_ENCRYPTION_KEY` in Vercel and redeploy.
4. Library -> Manage -> Import... -> `sensitive.json` -> policy **overwrite** -> run the dry run, then apply. Each record is re-sealed with the new key.
5. Delete `sensitive.json` and the export. Keep the **old key** in your password manager for as long as snapshots made before the change are retained (up to 12 months of monthly snapshots; see [BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md#retention)): restoring such a snapshot brings back records sealed with the old key.

### Rotating `BACKUP_ENCRYPTION_KEY`

1. Keep the old key. Every snapshot already in GitHub stays encrypted with it; to open one later, run the restore CLI with the old key in the environment (a variable already set in your shell takes precedence over `.env.local`).
2. Set the new key in Vercel and redeploy.
3. Press **Back up now** and verify the new snapshot with a dry-run restore. Unchanged detection now decrypts and validates the remote snapshot using the current key; a rotated key causes a fresh snapshot.
4. Retire the old key only after every snapshot you still care about has aged out of retention.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Google shows **Error 400: redirect_uri_mismatch** | The callback URL the app sent is not registered in the OAuth client. | Add the exact URI `https://<host>/api/auth/callback/google` (scheme, host, port, no trailing slash). Preview URLs and `www`/non-`www` variants are different hosts. Changes can take a few minutes to apply. |
| Login page shows "That Google account is not allowed" (`AccessDenied`) | The email is not in `OWNER_EMAILS`, the address differs in spelling, or Google reports it unverified. The OAuth app may also be in Testing status without you as a test user. | Check `OWNER_EMAILS` (comma-separated, compared case-insensitively), redeploy, and check the consent-screen test users. |
| Login shows "Authentication is not configured" (`Configuration`) | `AUTH_SECRET`, `AUTH_GOOGLE_ID` or `AUTH_GOOGLE_SECRET` missing. | Settings -> status reports which groups are set; fix in Vercel and redeploy. |
| "The database is unreachable", `/api/health` is 503, saves are queued | `REDIS_URL` wrong, database paused/deleted, network path blocked, or the 3 s connect / 5 s command timeout was exceeded. | Test the URL from your laptop with `redis-cli -u "$REDIS_URL" ping`. Confirm it is `redis://` not `rediss://`. Check the Redis Cloud console for the database state and any source-IP allowlist (Vercel egress IPs are not fixed). Check the function region against the Redis region ([section 6](#6-function-region)). Free tier connection limits: the app keeps one connection per function instance. |
| **"Library not initialised"** screen, or `/r/<slug>` shows "Temporarily unavailable" | Redis answers but `qr:v1:meta:schema` is missing: first run, or the database lost its data. Writes are blocked on purpose. | If this is not a first run, **do not** choose "Start with an empty library". Restore from the latest backup (Recovery screen) or the CLI. Runbook: [BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md#total-loss-recovery-runbook). |
| Cron returns **401** | `CRON_SECRET` in Vercel does not match what was sent, the secret was added after the last deploy, or you called the route by hand without the `Bearer` header. | Re-set `CRON_SECRET`, redeploy, and check the Vercel cron log. A `501 NOT_CONFIGURED` means the variable is missing entirely. |
| Backups fail with GitHub **403** | Token lacks "Contents: Read and write", or GitHub's rate limit was hit (message says "rate limit reached", with a retry hint). | Recreate the token with the right permission on the right repo; for rate limits wait and retry. |
| Backups fail with GitHub **404** | Wrong `BACKUP_GITHUB_REPO` / `BACKUP_GITHUB_BRANCH`, or the token is not scoped to that repo (GitHub reports 404 for repositories a token cannot see). | Check `owner/name`, make sure the branch exists (initialise the repo with a README), and that the token's repository access includes it. |
| Backups fail with GitHub **401** | Token expired or revoked. | Create a new token ([SETUP.md](./SETUP.md#8-github-backup-repository)). |
| Saving a Wi-Fi or contact code returns **NOT_CONFIGURED** ("Set DATA_ENCRYPTION_KEY...") | `DATA_ENCRYPTION_KEY` is not set (or is not 32 bytes base64). Opening a sealed record fails the same way if the key is missing or wrong. | Set a valid key and redeploy. The code can still be generated and downloaded locally. |
| The camera scanner says it needs a secure connection | Browsers expose the camera only on HTTPS or `localhost`. | Use the `https://` address; on a phone testing a LAN dev server, use an HTTPS tunnel or the deployed site. You can always scan from an uploaded image. |
| After a deploy the installed app shows old screens or fails offline | The service worker serves cached pages when offline or when the network is slow (4 s timeout), and an offline client cannot discover a new deployment until it reconnects. | Reload while online (pages are network-first). To force it: DevTools -> Application -> Service Workers -> Unregister, then Clear site data. Each build registers a versioned worker URL; activation prunes earlier QR page/static caches. If an installed client has not revisited online, it cannot discover updates. |
| Saves fail with a generic "Something went wrong", the redirect page shows "Temporarily unavailable" for links with analytics or a scan limit, and the storage banner is near 100 % | Redis is at its memory limit and rejecting writes (the hot path writes counters, see [REDIS_SCHEMA.md](./REDIS_SCHEMA.md)). | Free space: reset analytics (Analytics page) or lower retention (Settings -> Analytics), permanently delete trashed codes, run Settings -> Index maintenance -> repair (also removes orphan logos). Existing analytics keys keep their old TTL after you lower retention. |
| Storage banner "Redis storage is N % full" | `used_memory` / `maxmemory` > 80 %. The figure is for the whole instance, including the research site. | As above; also check what the research site stores. |
| `bun run restore` says "REDIS_URL is not set" | Not exported and not in `.env.local`/`.env` in the current directory. | Export it or pass `--redis-url`. |

## Operational notes

QR Studio is a single-owner tool running on free tiers, and the weak point is the free Redis database, not the application. It has no persistence guarantee, no TLS and no backups of its own, so the daily GitHub snapshot is the only protection; check Settings occasionally for "Backups are up to date" and restore a snapshot in dry-run mode every few months to prove the key and the file still work. Keep the database active: Redis Cloud's free-tier policy can remove databases that go unused for a long period (confirm the current rule in Redis Cloud's documentation). The daily cron run issues Redis commands as long as `CRON_SECRET` is set and the deployment is live, which is incidental activity rather than a designed keep-alive, so do not rely on it alone. Never give Preview deployments the production Redis URL. Treat a printed dynamic QR code as a promise: keep the domain, and keep the slug-to-destination mapping backed up. The default function and body limits of Vercel's Hobby plan apply (for example the documented 4.5 MB request-body limit), which matters for very large restore uploads: use the CLI for those.

## Setup script safety

`scripts/setup-vercel.sh` is a one-time helper. Save independently generated `DATA_ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY` in a password manager and export them before running it. The script no longer replaces existing production variables with `--force`, or generates unrecoverable encryption keys that disappear after upload. Never rerun it to rotate secrets; follow the rotation steps above.
