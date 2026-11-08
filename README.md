# QR Studio

A private, single-owner QR code generator and manager: create styled static and dynamic (redirecting) codes, keep them in a library, see scan statistics, scan codes yourself, and use it offline as an installable PWA. Built with Next.js 16 (App Router), Auth.js v5 (Google), and Redis Cloud Free as the only datastore, configured for Vercel Hobby with the intended domain `qr.zeyuyaoy.com` (production is not yet deployed).

> **Redis Cloud Free callout.** The free Redis tier has **no TLS**, **no durability guarantee** and **no backups**, and the database is shared with another site (research.zeyuyaoy.com). QR Studio compensates: Wi-Fi and contact-card codes are encrypted before they are stored, link passwords are hashed, an "initialised" marker detects total data loss, and a daily encrypted snapshot goes to a private GitHub repo. It cannot compensate for everything: destinations, names and tags cross the network in clear text, and anything changed since the last snapshot is lost if Redis is wiped. Read [SECURITY.md](docs/SECURITY.md) and [BACKUP_AND_RESTORE.md](docs/BACKUP_AND_RESTORE.md) before relying on it.

## Features

**Content types (12).** URL, text, email, phone, SMS, Wi-Fi, vCard (3.0), calendar event (iCalendar, time-zone aware), geo location, WhatsApp, social profile (Instagram, X, LinkedIn, GitHub, Facebook, YouTube, TikTok, Bluesky, ORCID, custom), DOI. Only URL, social, DOI and WhatsApp can be dynamic.

**Styling.** Colours, linear/radial gradient, transparent background, six dot shapes, finder shapes and colours, error correction L/M/Q/H, quiet zone, size 128-4096 px, eight built-in presets, centre logo (rasterised in the browser, <= 12 KB, background and padding options). Live readability checks (contrast, quiet zone, logo coverage vs. error correction, capacity).

**Exports.** PNG, SVG, WebP, JPEG; copy image, share (Web Share), print; filename templates (`{name}`, `{type}`, `{slug}`); ZIP for bulk. Everything is rendered in the browser.

**Library.** Folders, tags, favourites, pin, archive, trash and permanent delete, search, filters, sort, duplicate, batch actions, JSON/CSV export, JSON/CSV import with dry run and policies (skip / overwrite / copies).

**Dynamic links.** Short link `/r/<slug>` with a random or custom slug; change the destination without reprinting; pause/resume; activation date; absolute or relative expiry; scan limit; password gate; replacement redirect or message after expiry; owner-branded public pages. Destinations are validated (http/https only, no private/loopback hosts, no loops).

**Analytics.** Accepted-scan counters per code, daily trend, device categories, country (optional, Vercel only), top codes, recent activity, CSV export, configurable retention (7-365 days), reset. No raw IPs or user agents are stored.

**Bulk and templates.** Paste URLs or CSV (up to 500 rows), map columns, per-row validation, download a ZIP and/or save to the library; style templates you can save, apply to existing codes, export and import.

**Scanner.** Camera (native `BarcodeDetector` or `jsQR`) and image upload; recognises the supported types; links need confirmation before opening; "recreate" sends a scan back to the generator.

**PWA and offline.** Installable, service-worker shell, drafts and library cache in IndexedDB, offline queue with idempotent replay and a deterministic conflict policy, Web Share Target (Chromium/Android), app shortcuts.

**Backup and disaster recovery.** Daily encrypted snapshots to a private GitHub repo (AES-256-GCM, authenticated header, checksum, retention), manual runs, encrypted download, restore from the UI (dry run, merge/replace, conflict policies), a restore CLI, a recovery screen when Redis loses its data, index verify/repair.

## Tech stack

Bun 1.4.2, Next.js 16.4 (App Router, Bun runtime), React 19, TypeScript (strict), Tailwind CSS 4 with shadcn/ui on `@base-ui/react`, Auth.js (`next-auth` 5 beta) with Google, `redis` (node-redis 6) with Lua scripts, zod 4, `qr-code-styling` + `qrcode-generator` (render), `jsqr` (scan fallback), `idb-keyval`, `fflate`, `recharts`, `sonner`. Tests: Vitest 5, Testing Library, Playwright, `sharp` + `jsQR` for independent decoding. Hosting: Vercel Hobby (+ Vercel Cron), GitHub (backups).

## Quick start

```bash
bun install --frozen-lockfile
cp .env.example .env.local        # fill in the values; see docs/SETUP.md
bun run redis:test                # disposable Redis on localhost:6390 (Docker)
bun run dev                       # http://localhost:3000
```

Required to sign in: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `OWNER_EMAILS` (or the test sign-in for local work). On first run choose "Start with an empty library". Full walkthrough, including Google OAuth client creation: [docs/SETUP.md](docs/SETUP.md).

## Scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Next.js dev server |
| `bun run build` / `bun run start` | Production build / server |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | ESLint |
| `bun run test` | Unit tests (Vitest) |
| `bun run test:integration` | Integration tests against local Redis (`localhost:6390`) |
| `bun run redis:test` | Start the disposable Redis container (`qr-test-redis`, port 6390) |
| `bun run test:e2e` | Playwright end-to-end tests (builds the app, Redis database 5) |
| `bun run test:all` | Typecheck, lint, unit, integration, E2E |
| `bun run restore <flags>` | Restore a snapshot into Redis from the command line ([flags](docs/BACKUP_AND_RESTORE.md#restore-cli)) |
| `bun scripts/gen-icons.mjs` | Regenerate PWA icons (needs `sharp`) |

## Project layout

```
src/
  auth.ts                  Auth.js config (Google, owner allow-list, test provider)
  app/
    (app)/                 private pages: Create, Library, Scan, Analytics, Templates, Bulk, Settings
    api/                   owner API, health, cron, Auth.js handler
    r/[slug]/route.ts      public redirect resolver
    login, expired, offline, manifest.ts
  components/              UI by area (qr, library, bulk, templates, scan, analytics, settings, ui)
  lib/
    schema.ts expiry.ts url-safety.ts crypto.ts seal.ts resolve.ts public-pages.ts guard.ts api.ts env.ts
    redis/                 client, keys, Lua scripts, repository, maintenance, migrations
    backup/                envelope, snapshot, GitHub client, run/status
    qr/                    payload encoders, parser, styling, render, export, readability
    client/                typed API client, offline queue, hooks
public/sw.js               service worker
scripts/restore.ts         disaster-recovery CLI
tests/{unit,integration,e2e}
vercel.json                daily backup cron
.env.example               every environment variable, with generation hints
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Local development, Google OAuth client, Redis Cloud connection, GitHub backup repo, keys |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel project, environment variables, cron, domain, verification checklist, secret rotation, troubleshooting, operational notes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, request flows, module map, API reference, decisions, performance, known limitations |
| [docs/REDIS_SCHEMA.md](docs/REDIS_SCHEMA.md) | Keys, Lua scripts, capacity, consistency, free-tier limits, migration path |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, auth, CSRF, headers, rate limits, encryption, privacy |
| [docs/BACKUP_AND_RESTORE.md](docs/BACKUP_AND_RESTORE.md) | Snapshot design, retention, restore UI and CLI, total-loss runbook |
| [docs/TESTING.md](docs/TESTING.md) | Test layers, commands, safety guards, CI, writing tests |

## Known limitations (short list)

Redis Cloud Free: no TLS, no durability, shared with another site, ~30 MB, ~30 connections, possible removal after prolonged inactivity. Offline: library detail pages work offline only after being visited; dynamic links created offline are not live until synced. Web Share Target only on Chromium/Android; image copy unsupported in some browsers; geo analytics only on Vercel; CSP allows inline scripts; link previewers can count as scans. The complete list is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-limitations).

## Licence

MIT. See [LICENSE](LICENSE).

## Verification and release status

See [Testing](docs/TESTING.md) for reproducible checks and [Deployment](docs/DEPLOYMENT.md) for production setup and verification. Local checks do not establish a live deployment or a real GitHub backup.
