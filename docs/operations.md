### Operations

#### Local sign-in

In Google Cloud, create an OAuth web application and add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI. If the consent screen is in testing mode, add your account as a test user. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `OWNER_EMAILS` in `.env.local`.

For disposable local development without Google, set `ENABLE_TEST_AUTH=1` and generate `TEST_AUTH_SECRET` with `openssl rand -hex 16`. The login page can then sign in as the first configured owner. Keep both variables out of deployed environments and databases holding real data. Test sign-in is disabled at runtime on Vercel.

#### Vercel deployment

1. Import the repository as a Next.js project. `vercel.json` sets the build commands, Singapore function region, and daily backup schedule. Use a function region close to Redis.
2. Add production variables from [the environment template](../.env.example). Set `NEXT_PUBLIC_APP_URL=https://qr.zeyuyaoy.com` before building. Printed dynamic codes depend on this origin. Use separate credentials and Redis for previews that need database access.
3. In Vercel Domains, add `qr.zeyuyaoy.com` and apply the DNS record Vercel displays. Add `https://qr.zeyuyaoy.com/api/auth/callback/google` to the Google OAuth client.
4. Deploy, check `/api/health`, sign in, and inspect Settings for Redis and backup status. Test an existing short link in a signed-out browser. Check the installed manifest and service worker on the production origin. On first setup, initialize the library only after confirming the database is new.

Use the Redis Cloud connection string for `REDIS_URL` and match its transport scheme to the database's TLS setting. Generate `AUTH_SECRET` and both encryption keys with separate `openssl rand -base64 32` runs. Generate `CRON_SECRET` with `openssl rand -hex 32`. Keep server secrets in Vercel and the keys in an independent password manager. Changes to Vercel environment variables require a redeploy. Rolling a deployment back leaves Redis writes in place.

Vercel supplies `VERCEL=1` for Analytics and Speed Insights. The platform selects the Bun patch release within the `1.x` range in `vercel.json`.

The app uses the portfolio's default Sundaze and sage colors, compact control radii, and the same locally served Nunito font. Keep the CSS colors and the QR install icon palette in sync when changing the brand.

#### Redis and security

- All production keys live under `qr:v1:`. Key definitions are in [keys.ts](../src/lib/redis/keys.ts). Never use database-wide commands such as `FLUSHDB` or `FLUSHALL`. Use Settings → Index maintenance to verify and repair QR indexes.
- QR Studio reuses one lazy connection per function instance. Each Lua script runs directly on first use, then by SHA, with a fallback for missing scripts. Check the Redis Cloud console for the instance's actual memory, connection, eviction, inactivity, TLS, and persistence settings. A full or unavailable instance can return 503 on redirects that require writes. A namespace shares the instance's capacity and failure modes.
- Owner APIs recheck the Google email allowlist. Mutations require a CSRF header and validate the request origin when present. Public redirects use Redis Lua for atomic scan-limit enforcement. Link passwords use scrypt. Resetting analytics also resets scan-limit counters.
- With `redis://`, Redis credentials, destinations, metadata, and password hashes travel in clear text. Wi-Fi and vCard contents are sealed with `DATA_ENCRYPTION_KEY`. Plain library JSON exports and the browser's IndexedDB cache can contain decrypted data. Sign out to clear private local data.
- The service worker caches pages and static assets for offline use. APIs and short-link responses stay out of that cache. Library detail pages need a prior visit to open offline. CSP allows inline scripts for Next.js bootstrap and inline styles.

#### Backups

Create a private GitHub repository with an existing branch, and set `BACKUP_GITHUB_REPO`, `BACKUP_GITHUB_BRANCH` and a fine-grained `BACKUP_GITHUB_TOKEN` limited to that repository with Contents read/write. Vercel calls `/api/cron/backup` daily at 03:17 UTC with `CRON_SECRET` as the bearer token. In Settings → Backup, run **Back up now** and dry-run a restore to check the setup. **Download encrypted export** gives you a second copy you can store separately.

Backups capture records, passwords as hashes, folders, templates, referenced logos, settings, counters, and unexpired analytics. Recent activity and rate-limit state are excluded. A run skips an uninitialized library and refuses unreadable records. Retention keeps the newest 30 snapshots plus one per month for the newest 12 months represented. Pruned snapshots can remain in Git history. Keep old encryption keys for as long as you need to recover those snapshots.

#### Restore

Pause library edits during restore or index repair. Snapshots are assembled from multiple Redis reads, so a busy library can change while a backup runs. In Settings → Backup, choose a GitHub snapshot or upload an encrypted export. Dry-run first and review counts, invalid records and slug conflicts. Merge adds or updates records, with a choice of which version wins. Replace also deletes records, folders, and templates absent from the snapshot and requires explicit confirmation. Restores span multiple writes. After an interruption, inspect the report and dry-run again before retrying.

If the app is unavailable or an upload exceeds its request limit, run the CLI from the repository. It reads the same Redis and backup variables as the app. Set the keys in your shell to override `.env.local` when opening an older snapshot.

```sh
bun run restore --list
bun run restore --github
bun run restore --file ./snapshot.qrbackup.json --redis-url redis://localhost:6390
bun run restore --file ./snapshot.qrbackup.json --redis-url redis://localhost:6390 --apply
```

The first command lists snapshots. The next two are dry runs. The last command applies a merge to disposable local Redis for a recovery drill. To select a particular GitHub snapshot, add `--name <snapshot>` to `--github`. Use `--help` for conflict policies and replace mode. A non-local or replace write requires both `--apply` and `--yes`.

##### Total data loss

1. If the app reports **Library not initialised** or short links return 503 with Redis reachable, verify the Vercel Redis URL and database in Redis Cloud. A healthy `/api/health` alone cannot establish that the library exists.
2. Restore the latest good snapshot from the recovery screen, an encrypted export, or the CLI. Avoid **Start with an empty library** unless you accept the loss. If the only remaining copy is a browser cache, recover from that device. Cache or plain library imports omit password hashes. Previously protected links stay paused until you set a new password and enable them.
3. Verify library counts, test a printed short link, run index verification, and take a fresh backup. Changes and scan counts since the snapshot may be lost, including scans counted against a limit. Check whether the shared research database was affected.

##### Rotating secrets

- Rotating `AUTH_SECRET` signs out existing sessions and changes rate-limit visitor hashes. After changing the Google secret, cron secret, or GitHub token, redeploy and verify sign-in or backups before retiring the old credential where the provider permits it. A shared Redis password change requires updating both sites.
- For `BACKUP_ENCRYPTION_KEY`, retain the old key, deploy the new one, then back up and dry-run restore the new snapshot. Existing snapshots still need their original key.
- For `DATA_ENCRYPTION_KEY`, export the library JSON while the old key works. In a secure local copy, retain only Wi-Fi and vCard records and their assets, and clear folders and templates. After deploying the new key, dry-run an overwrite import of that subset and apply it to reseal the records. Protect and delete the plaintext exports when finished. Keep the old key for older snapshots containing those records.

If the backup token fails, check repository, branch, token expiry and Contents permissions. If sign-in fails, check the callback URI, Google consent-screen users and the owner allowlist. If Redis is unreachable, check the connection scheme, credentials, connection count and service status before attempting repair or restore.
