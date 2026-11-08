# Testing

## Test pyramid

| Layer | Tooling | Needs | Speed | What it proves |
| --- | --- | --- | --- | --- |
| **Static** | `tsc --noEmit`, ESLint (`eslint-config-next`) | nothing | seconds | Types, React/Next lint rules |
| **Unit** (`tests/unit`) | Vitest on Bun (happy-dom for `.tsx`) | nothing | seconds | Pure logic: schemas, expiry, URL safety, crypto, encoders, parsers, envelope, retention, CSV, public HTML |
| **Integration** (`tests/integration`) | Vitest against a real Redis | local disposable Redis | tens of seconds | Repository, Lua scripts, concurrency, resolver, backup/restore, repair/import, fail-closed behaviour |
| **End-to-end** (`tests/e2e`) | Playwright (Chromium; desktop, Pixel 7, anonymous projects) | local Redis, a production build | minutes | Real UI + API + Redis; exported QR images decoded by an independent decoder; PWA offline behaviour |

Most logic is deliberately pure (`expiry.ts`, `url-safety.ts`, `payload.ts`, `parse.ts`, `envelope.ts`, `planPrune`) so it is covered at the cheapest layer; integration tests then cover what only Redis can prove (atomicity, indexes), and E2E covers wiring and the browser.

## Commands

| Command | What it runs |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | `eslint .` |
| `bun run test` | `vitest run --project unit` |
| `bun run test:integration` | `vitest run --project integration` (needs Redis on `localhost:6390`) |
| `bun run redis:test` | `docker run -d --rm --name qr-test-redis -p 6390:6379 redis:7-alpine` |
| `bun run test:e2e` | `playwright test` (builds the app, serves it on port 3200) |
| `bun run test:all` | typecheck, lint, unit, integration, E2E in sequence |

Set `E2E_PORT=3210` to use a different local server port if 3200 is occupied.

First-time E2E setup: `bunx --bun playwright install chromium`. Stop the Redis container with `docker stop qr-test-redis`.

## Disposable Redis and the safety guards

The suites write, wipe and flood Redis. They must never see the real database, and there are guards in four places:

| Guard | Where | Behaviour |
| --- | --- | --- |
| Local hosts only (integration) | `tests/integration/helpers/env.ts` `assertLocalRedis` | Refuses to run unless the `REDIS_URL` host is `localhost`, `127.0.0.1` or `::1`. Default URL `redis://localhost:6390`. |
| Random key prefix per file (integration) | `setupEnv()` | Each test file gets `qr:test:<12 hex>:`; the app honours `QR_KEY_PREFIX` **only when `NODE_ENV=test`** (`env.keyPrefix`). Cleanup uses `SCAN` + `UNLINK` under that prefix only, the helper's `own()` refuses any other key, and `FLUSHDB`/`FLUSHALL` are never used. The helper also clears `BACKUP_GITHUB_*`, `VERCEL*` and `ENABLE_TEST_AUTH` from the environment. |
| Local hosts only (E2E) | `playwright.config.ts`, `tests/e2e/global-setup.ts` | Throws unless `E2E_REDIS_URL` (default `redis://localhost:6390/5`) points at localhost. |
| Logical database 5 (E2E) | same | E2E uses database 5 and, at start, deletes `qr:v1:*` in it (the real namespace, not a test prefix). Never point `E2E_REDIS_URL` or a dev `.env.local` at a database 5 you care about, even locally. |

Also: `assertOwnKey` and `runScript` independently refuse keys outside the active prefix (tested in `tests/integration/analytics.test.ts`).

## What each suite covers

### Unit (`tests/unit`)

| File | Covers |
| --- | --- |
| `api-guard.test.ts` | Response envelope, error-code to HTTP mapping, `toErrorResponse` (no leaks), `readJson` limits, CSRF (`assertSameOrigin`), `requireCron` (constant-time, never open) |
| `backup.test.ts` | Envelope round trip, wrong key, flipped bytes, authenticated header, checksum, snapshot pack/unpack, newer-schema rejection, content hash, `snapshotName`, `planPrune` retention rules |
| `crypto.test.ts` | Key parsing, AES-GCM layout/AAD/tamper, SHA-256, `hmacShort`, scrypt hashing and NFKC, malformed hashes |
| `expiry.test.ts` | `evaluateLink` precedence, activation, absolute/relative expiry, scan limits, `isRetired` |
| `ids.test.ts` | ID/slug/opId generation (alphabet, uniqueness, uniformity), `slugify` |
| `library.test.ts` | `queryLibrary` filters/search/order, library file schema |
| `page-header.test.tsx` | Small UI components (happy-dom) |
| `parse.test.ts` | `parseScanned` round trips with every encoder, Wi-Fi/vCard escaping edge cases |
| `payload.test.ts` | Every content type's encoding and validation, DST handling, iCalendar, capacity helpers |
| `records.test.ts` | Record/settings/input schemas, `toView`, `migrateRecord`, `seal`/`open` |
| `style-readability.test.ts` | Style schema, presets, contrast maths, readability checks, renderer options |
| `url-safety.test.ts` | `checkDestination` accept/reject matrix (private IPs, IPv6, trailing dot, loops), `appHost` |
| `web-output.test.ts` | CSV escaping and formula neutralisation, HTML escaping, public pages and headers, device classifier |
| `bulk-csv.test.ts` | Bulk CSV parsing, delimiter/header detection, row validation, unique file names |

### Integration (`tests/integration`)

| File | Covers |
| --- | --- |
| `repo.test.ts` | Sentinel and write blocking; code CRUD; `rev` and atomic optimistic concurrency (20 parallel edits, one wins); slug uniqueness under 50 concurrent creates; trash/purge; index consistency; folders, tags, templates, settings; logo assets; sealing at rest (no plaintext anywhere under the prefix) |
| `resolve.test.ts` | Redirect semantics (307, byte-exact destination), HEAD never counts, 404/503/403/410 states and distinct pages, replacement redirect, analytics switches, 100 concurrent scans of a limit-10 link, destination re-validation, password gate (counted only on success, throttles, cross-origin rejection, no raw IP/UA stored) |
| `analytics.test.ts` | `acceptScan` atomicity and statistics/TTL, `hit()` buckets, namespace safety of scripts and resets, reports |
| `backup-restore.test.ts` | `collectSnapshot` (no decryption), dry runs change nothing, restore into empty library (everything incl. counters/stats/sentinel), idempotence, sentinel last, merge policies, slug conflicts, replace mode, foreign keys survive, rejected snapshots never write, no plaintext in the encrypted file |
| `backup-run.test.ts` | Config checks, skip when uninitialised, created/unchanged, token handling, retention and pruning, recorded failures (rate limit, 5xx, network, 401/404), locking and lock expiry, freshness around 36 h, GitHub listing/restore round trip against a fake GitHub (`helpers/github-fake.ts`) |
| `maintenance.test.ts` | Index repair (damage detected in dry run, fixed on apply), slug conflicts, library import policies and validation, passwords never imported |
| `unavailable.test.ts` | Redis down or `REDIS_URL` missing: fail-closed 503 pages, `REDIS_UNAVAILABLE` envelope, no URL leaks, `QR_REDIS_URL` alias |

### End-to-end (`tests/e2e`)

| File (project) | Covers |
| --- | --- |
| `anonymous.spec.ts` (anonymous) | Private pages redirect to login; private APIs 401; health/expired/unknown slug/cron auth; security headers and no secret in public output; CSRF header requirement |
| `generator.spec.ts` | Live static generation; **PNG/SVG/WebP/JPEG exports decode to the exact payload with jsQR**; styled codes still scan; low-contrast warning; Wi-Fi format; invalid URL blocks save |
| `dynamic.spec.ts` | Dynamic QR encodes the short link and redirects signed out; edit destination and pause/resume; expiry and replacement redirect; scan limit; password gate; unsafe destinations rejected |
| `library.spec.ts` | Library lifecycle, `REV_MISMATCH`, slug uniqueness, Wi-Fi sealed at rest in Redis, JSON export/import round trip, analytics counting/CSV/reset |
| `tools.spec.ts` | Scanner (uploaded image, no-QR message, link needs confirmation), scan-to-recreate, Web Share Target prefill, bulk (paste, validation, ZIP of decodable codes, save), templates, analytics/settings render, encrypted export + restore dry run + corrupted snapshot rejection |
| `pwa.spec.ts` | Manifest and icons, service-worker headers, offline shell + export, private API never cached, offline create queued then synced, offline dynamic link stays "not live" until confirmed |
| `mobile.spec.ts` (mobile, Pixel 7) | Bottom navigation, no horizontal scroll, touch targets >= 40 px |

## Independent QR decoding

`tests/e2e/helpers/decode.ts` rasterises an exported file with `sharp` and decodes it with `jsQR`, a different code path than the encoder (`qr-code-styling`/`qrcode-generator`). `tools.spec.ts` also builds scanner inputs with `qrcode-generator` directly. Unit tests check the readability *heuristics*; only these decodes prove a styled code actually scans. Real-phone scanning of printed output is not automated.

## PWA offline testing approach

Playwright runs against the production build (`next start`), because the service worker is only registered when `NODE_ENV=production`. The pattern in `pwa.spec.ts`: wait for the worker and for the build-versioned `qr-pages-*` cache to hold the shell, reload so the page is controlled, then `context.setOffline(true)`, interact, assert, and go back online. Assertions inspect `caches.keys()` to prove that no `/api/` or `/r/` response is ever cached, and poll the API (via the `request` fixture, which is not offline) to observe sync.

## Writing new tests

- **Unit:** add `tests/unit/<topic>.test.ts`. Path alias `@` maps to `src`. For component tests start the file with `// @vitest-environment happy-dom`.
- **Integration:** the first import must be the helper, so the environment (local Redis, random prefix, test keys) is set before any app module reads it:

  ```ts
  import { T } from "./helpers/boot";
  import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
  import { initMeta, createCode } from "@/lib/redis/repo";
  import { dynamicUrl } from "./helpers/fixtures";

  beforeAll(async () => { await T.reset(); await initMeta(); });
  afterAll(async () => { await T.cleanup(); await T.close(); });

  it("creates a code", async () => {
    const rec = await createCode(dynamicUrl({ slug: "demo-1" }));
    expect(rec.rev).toBe(1);
    expect(await T.keys()).toContain(T.key(`slug:demo-1`));
  });
  ```
  `T.raw()` is an independent client for assertions, `T.dump()` gives a deterministic dump for before/after comparisons, `helpers/seed.ts` builds a representative library, and `helpers/github-fake.ts` stubs the GitHub API. Integration files run one at a time (`fileParallelism: false`).
- **E2E:** add `tests/e2e/<topic>.spec.ts`; the default project is already signed in as `owner@example.test` (test auth). Mutating API calls need `CSRF` headers from `helpers/app.ts`. Keep data names unique; the database is shared by all specs in a run. Decode exports with `decodeQr` instead of trusting visuals.

## CI

The repository has `.github/workflows/ci.yml`, which does the following on pushes to `main` and on pull requests. It is reproduced here as the reference setup:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7-alpine
        ports: ["6390:6379"]
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 3s --health-retries 10
    env:
      REDIS_URL: redis://localhost:6390
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run test
      - run: bun run test:integration
      - run: bunx --bun playwright install --with-deps chromium
      - run: bun run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
```

The service container must be published on **6390** because that is what the suites default to; E2E uses database 5 of the same server. No secrets are needed in CI: the E2E run supplies its own test keys. Do not add the production `REDIS_URL` as a CI secret.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Refusing to run ... non-local Redis host` | `REDIS_URL` in your shell points at a remote host. `unset REDIS_URL` or use `redis://localhost:6390`. |
| `ECONNREFUSED 127.0.0.1:6390` or "Redis is unavailable" | The container is not running: `bun run redis:test`. If the name `qr-test-redis` is taken, `docker rm -f qr-test-redis`. |
| E2E: port 3200 busy / stale server | `reuseExistingServer` is disabled. Use `E2E_PORT=3210` or stop the old process. |
| E2E: sign-in fails in `global-setup` (401/403) | The webServer started without `ENABLE_TEST_AUTH`/`TEST_AUTH_SECRET` (a server already running on 3200 with other env). Stop it and rerun. |
| E2E build is slow or fails | It runs `bun run build` into `.next-e2e` (`NEXT_DIST_DIR`), separate from your dev `.next`. Delete `.next-e2e` to rebuild from scratch. |
| E2E writes to the real GitHub backup repo | The Next build/server also reads `.env.local`. `E2E_ENV` overrides only the variables it lists (not `BACKUP_GITHUB_REPO/TOKEN/BRANCH`), so a developer `.env.local` containing them lets `tools.spec.ts`'s manual-backup step reach GitHub (the test expects "failed" because it is unconfigured). Run E2E from a checkout without those variables, or temporarily move `.env.local` aside. |
| Integration test hangs | A previous run left connections; the suites use `reconnectStrategy: false` and 3 s connect timeouts, so a hang usually means the tests were interrupted mid-run. Restart Redis. |
| Stray test keys remain | Integration prefixes look like `qr:test:<hex>:`. Remove with `redis-cli -p 6390 --scan --pattern 'qr:test:*' \| xargs redis-cli -p 6390 unlink` on the **local** container only. |
| `test:integration` finds no tests | Run it from the repository root; the project includes `tests/integration/**/*.test.ts`. |
| Git shows `.next-e2e/`, `tests/e2e/.auth/` or `playwright-report/` as untracked | The repository's `.gitignore` currently lists `playwright-report` and `test-results` but not `.next-e2e` or `tests/e2e/.auth`. The auth files hold a test-only session cookie, not a real credential; add both paths to `.gitignore` before committing. |

The E2E web server always builds fresh and refuses to reuse an existing server. It uses the supported production webpack compiler because Turbopack PostCSS workers can be denied local sockets in restricted runners. The normal production build still tests Turbopack under Bun. Test counts depend on the checkout; use fresh command output as evidence. Local suites do not verify a live deployment, real GitHub backup, or physical-device behavior.
