### QR Studio

I made a personal QR code generator and library for my personal site at [qr.zeyuyaoy.com](https://qr.zeyuyaoy.com). With this, I can create static codes or editable short links, scan them with a camera or an image, and export codes individually or in bulk. The library supports folders, tags, templates, scan analytics, and offline drafts. You can pause, schedule, password-protect, or limit dynamic links by scan count.

The app uses Next.js App Router, TypeScript, React, Tailwind CSS and Base UI. Auth.js handles Google sign-in, and Redis stores library records, redirect indexes, and analytics. Vercel serves the app and schedules backups to a private GitHub repository.

#### Run locally

Install Bun 1.4.2 or later and start a disposable Redis using Docker.

```sh
bun install --frozen-lockfile
bun run redis:test
cp .env.example .env.local
bun run dev
```

Set the Auth.js secret, Google credentials, owner email, and independent encryption keys in `.env.local`. The template lists what each variable controls.

Then, open `http://localhost:3000`. On a fresh local database, choose **Start with an empty library** after signing in.

For Google callback setup or local-only test sign-in, see [the operations manual](docs/operations.md).

#### Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run test:integration
bunx playwright install chromium
bun run test:e2e
bun run build
bunx knip@6.44.2
```

Integration and browser tests require disposable local Redis on port 6390 by default. Integration tests use random prefixes, and Playwright uses logical database 5 by default. An override via `E2E_REDIS_URL` must be credential-free loopback Redis with an explicit nonzero database. Playwright builds a production app to exercise the service worker. `bun run test:all` runs type checking, lint, and the three test suites. GitHub Actions reads the Bun pin from `package.json` and exercises Turbopack through Playwright. Local Playwright uses Webpack so it can run where Turbopack's build worker cannot open a socket. Regenerate install icons with `bun scripts/gen-icons.mjs`.

#### Deploy and recover

[The operations manual](docs/operations.md) covers Vercel, the custom domain, Google OAuth, encrypted snapshots, recovery, and secret rotation. Redis keys use `qr:v1:`, separate from the research site, but both sites share capacity and outage risk on a shared database. With a non-TLS Redis connection, credentials and most library data cross the network in clear text. Wi-Fi and vCard contents are sealed before storage.

Offline drafts and cached library records live on the device. Dynamic links created offline become live after sync. GitHub snapshots are encrypted and restore only the data captured when they ran. Keep the data and backup keys independently of the deployment and the backup repository.

This project is licensed under the [MIT License](LICENSE). Please send security reports privately to me at [cytronicoder+hi@gmail.com](mailto:cytronicoder+hi@gmail.com).
