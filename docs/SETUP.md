# Local setup

How to run QR Studio on your machine, how to create the Google OAuth client, and how to connect the real Redis Cloud database and the GitHub backup repository. For hosting, see [DEPLOYMENT.md](./DEPLOYMENT.md). For problems, see its [Troubleshooting](./DEPLOYMENT.md#troubleshooting) section.

## 1. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Bun | 1.4.2 | JavaScript runtime and package manager; `bun.lock` pins dependencies. |
| Docker | any recent | Disposable local Redis for development and tests. |
| OpenSSL | any | Generating secrets (`openssl rand`). |
| A Google account | - | The only way to sign in; also needed to create the OAuth client. |

## 2. Install

```bash
git clone <your fork or the repo URL> qr && cd qr
bun install --frozen-lockfile
cp .env.example .env.local
```

`.env.local` is git-ignored. Never commit it, never paste it into issues.

## 3. Local disposable Redis (Docker, port 6390)

```bash
bun run redis:test        # docker run -d --rm --name qr-test-redis -p 6390:6379 redis:7-alpine
docker stop qr-test-redis # when you are done; --rm deletes the container and its data
```

Port 6390 is deliberate: it will not collide with a Redis you may already run on 6379. The same container serves development (`redis://localhost:6390`, database 0) and the automated tests (integration suites use random key prefixes; E2E uses logical database 5). See [TESTING.md](./TESTING.md).

Develop against this container, not against the real database. It is free to wipe.

## 4. Environment variables (`.env.local`)

Full annotated template: [`.env.example`](../.env.example).

| Variable | Required | How to get it |
| --- | --- | --- |
| `REDIS_URL` | yes | Local: `redis://localhost:6390`. Real database: see [section 7](#7-using-the-existing-redis-cloud-database). |
| `NEXT_PUBLIC_APP_URL` | yes | `http://localhost:3000` locally. |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | yes | [Section 5](#5-create-the-google-oauth-client). |
| `OWNER_EMAILS` | yes | Your Google address; comma-separate several. |
| `DATA_ENCRYPTION_KEY` | for Wi-Fi / vCard codes | `openssl rand -base64 32` |
| `BACKUP_ENCRYPTION_KEY` | for backups | `openssl rand -base64 32` (a **different** run) |
| `CRON_SECRET` | for the cron route | `openssl rand -hex 32` |
| `BACKUP_GITHUB_REPO`, `BACKUP_GITHUB_TOKEN`, `BACKUP_GITHUB_BRANCH` | for backups | [Section 8](#8-github-backup-repository). Branch defaults to `main`. |
| `ENABLE_TEST_AUTH`, `TEST_AUTH_SECRET` | no | [Section 6](#6-test-sign-in-without-google). |

Generate the two encryption keys independently. They protect different things and must not be derived from each other:

```bash
openssl rand -base64 32   # -> DATA_ENCRYPTION_KEY
openssl rand -base64 32   # -> BACKUP_ENCRYPTION_KEY
openssl rand -hex 32      # -> CRON_SECRET
openssl rand -base64 32   # -> AUTH_SECRET
```

The code checks that each key decodes to exactly 32 bytes (`parseKey` in `src/lib/crypto.ts`) and refuses to start encrypting with anything else.

Put both encryption keys in a password manager that does not depend on Vercel or GitHub. If you lose `BACKUP_ENCRYPTION_KEY` the snapshots cannot be opened; if you lose `DATA_ENCRYPTION_KEY` sealed Wi-Fi/vCard records cannot be read, even from a backup.

## 5. Create the Google OAuth client

Sign-in is Google only, restricted to the emails in `OWNER_EMAILS` and to accounts with a verified email.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick one), e.g. "QR Studio".
2. **APIs & Services -> OAuth consent screen**. Choose **External**. Fill in app name, support email and developer contact email. Leave scopes at the defaults (`openid`, `email`, `profile`).
3. While the app is in **Testing** status, add your own Google address under **Test users**; only test users can sign in. Moving the app to **In production** removes that restriction, and `OWNER_EMAILS` still decides who gets in.
4. **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**. Application type **Web application**.
5. Under **Authorized redirect URIs** add both:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://qr.zeyuyaoy.com/api/auth/callback/google`

   (Authorized JavaScript origins are not needed for this flow.) The URIs must match exactly: scheme, host, port, no trailing slash.
6. Copy the **Client ID** and **Client secret** into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

There is no `AUTH_URL` to set: the app runs Auth.js with `trustHost: true` and builds callback URLs from the request host.

## 6. Test sign-in without Google

For local work and the automated tests there is a password-less credentials provider:

```dotenv
ENABLE_TEST_AUTH=1
TEST_AUTH_SECRET=<openssl rand -hex 16>
OWNER_EMAILS=you@example.com
```

The login page then shows **Test sign-in (non-production)**, which signs in as the first address in `OWNER_EMAILS`.

What the code enforces (`src/lib/env.ts`, `src/auth.ts`): the provider exists only if `ENABLE_TEST_AUTH=1` **and** `VERCEL` is absent; it also needs `TEST_AUTH_SECRET` to match and the email to be an owner. It is disabled on both production and preview Vercel deployments. Self-hosted deployments must leave the test flag unset. Never set `ENABLE_TEST_AUTH` in Vercel at all.

## 7. Using the existing Redis Cloud database

QR Studio and the research site (research.zeyuyaoy.com) can point at the same Redis Cloud Free database. `REDIS_URL` can hold exactly the same value as the research site's `RESEARCH_REDIS_URL`.

**Connection string.** Copy the public endpoint and the default user's password from the Redis Cloud console:

```
redis://default:<password>@<host>:<port>
```

Use `redis://`, **not** `rediss://`: the free tier does not offer TLS, and a TLS client against a plain port fails to connect. This means the password and all traffic cross the network unencrypted. Read [SECURITY.md](./SECURITY.md#redis-transport-is-not-encrypted-on-the-free-tier) before storing anything you care about. Percent-encode special characters in the password (`@` -> `%40`, `:` -> `%3A`, `/` -> `%2F`).

**ACL / user.** The code uses the default user's full command set; it never changes ACLs. If you create a dedicated Redis Cloud user, it needs at least: `GET SET DEL UNLINK EXISTS MGET SCAN EXPIRE TTL INCR` (strings), `SADD SREM SMEMBERS SCARD` (sets), `ZADD ZREM ZRANGE` (sorted sets), `HINCRBY HGETALL HSET HDEL` (hashes), `LPUSH LTRIM LRANGE` (list), `MULTI EXEC`, `SCRIPT LOAD EVALSHA EVAL`, `PING`, `INFO`. Key access may be limited to the `qr:v1:*` pattern. Whether your plan offers extra users is a Redis Cloud question; the app does not need it.

**Why sharing does not interfere.**

- Every key QR Studio writes starts with `qr:v1:`. The research site uses unprefixed keys (`link:`, `meta:`, `tag:`, `collection:`). The two spaces are disjoint; `meta:schema` (research) and `qr:v1:meta:schema` (this app) are different keys.
- QR Studio never calls `FLUSHDB`, `FLUSHALL` or `KEYS`. Bulk operations use `SCAN` with `MATCH qr:v1:*`, and every key passes `assertOwnKey` first.
- The Lua scripts only touch keys under the prefix.

What *is* shared and can interfere: the 30 MB memory budget, the connection limit (roughly 30 on the free tier per the code comments), and the failure domain (if the database is reset, both sites lose data). Details: [REDIS_SCHEMA.md](./REDIS_SCHEMA.md#redis-cloud-free-limitations-and-mitigations).

**First run against an empty database.** The app deliberately does not create its "initialised" marker on its own. After the first sign-in you will see **Library not initialised**; choose **Start with an empty library**. This is what lets the app tell "first run" apart from "Redis lost its data" later.

## 8. GitHub backup repository

Snapshots are encrypted before they leave the app, but still use a **private** repository.

1. Create a new **private** repository, e.g. `qr-studio-backups`. Initialise it with a README so the default branch exists (the code does not create branches).
2. Do not enable branch protection that blocks direct pushes to the target branch; the app commits through the Contents API.
3. GitHub -> Settings -> Developer settings -> Personal access tokens -> **Fine-grained tokens** -> Generate new token.
   - Resource owner: your account. Repository access: **Only select repositories** -> that one repo.
   - Repository permissions: **Contents: Read and write**. (Metadata: Read-only is added automatically.) Nothing else.
   - Set an expiry you can live with and put a reminder in your calendar; an expired token surfaces as a 401 in the backup history.
4. Set `BACKUP_GITHUB_REPO=<owner>/<repo>`, `BACKUP_GITHUB_TOKEN=<token>`, optionally `BACKUP_GITHUB_BRANCH`.

Snapshots are written to `snapshots/` in that repo. Details and retention: [BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md).

## 9. Run the app

```bash
bun run dev       # http://localhost:3000
```

Sign in (Google or test sign-in), choose **Start with an empty library**, create a code. Checks that do not need the browser:

```bash
curl -s localhost:3000/api/health          # {"ok":true}
curl -si localhost:3000/api/codes | head -1 # HTTP/1.1 401 ...
```

Notes for development:

- The service worker is registered only in production builds (`NODE_ENV=production`). To exercise offline behaviour locally, run `bun run build && bun run start`.
- The camera scanner needs a secure context: `localhost` is fine, `http://<lan-ip>:3000` is not.
- `NEXT_PUBLIC_APP_URL` is baked into the client bundle at build time; restart `bun run dev` after changing it.

Day-to-day commands are listed in the [README](../README.md#scripts); the test commands are in [TESTING.md](./TESTING.md).

## 10. Disaster-recovery CLI

`bun run restore ...` writes a snapshot into Redis without the web app. It reads `REDIS_URL` and `BACKUP_ENCRYPTION_KEY` (and the GitHub variables for `--github`) from `.env.local`/`.env` or the shell. Usage and the full runbook: [BACKUP_AND_RESTORE.md](./BACKUP_AND_RESTORE.md#restore-cli).
