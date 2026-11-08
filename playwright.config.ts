import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const BASE = `http://localhost:${PORT}`;
/** Disposable local Redis, logical DB 5 — isolated from anything else on the same server. NEVER point this at shared Redis. */
const REDIS = process.env.E2E_REDIS_URL ?? "redis://localhost:6390/5";
if (!/^redis:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(REDIS)) throw new Error("E2E refuses to run against a non-local Redis");

export const E2E_ENV = {
  REDIS_URL: REDIS,
  NEXT_PUBLIC_APP_URL: BASE,
  NEXT_DIST_DIR: process.env.E2E_DIST_DIR ?? ".next-e2e",
  AUTH_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only-secret",
  AUTH_GOOGLE_ID: "e2e",
  AUTH_GOOGLE_SECRET: "e2e",
  OWNER_EMAILS: "owner@example.test",
  ENABLE_TEST_AUTH: "1",
  TEST_AUTH_SECRET: "e2e-test-auth-secret",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  CRON_SECRET: "e2e-cron-secret",
  // Never let E2E touch a real backup repository, even if .env.local defines one.
  BACKUP_GITHUB_REPO: "",
  BACKUP_GITHUB_TOKEN: "",
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: BASE, trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "allow" },
  webServer: {
    // Turbopack's PostCSS worker binds a local socket, which restricted test runners can deny.
    command: `bun run build --webpack && bun --bun next start -p ${PORT}`,
    url: `${BASE}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: E2E_ENV,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/owner.json" }, testIgnore: /(mobile|anonymous)\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], storageState: "tests/e2e/.auth/owner.json" }, testMatch: /mobile\.spec\.ts/ },
    { name: "anonymous", use: { ...devices["Desktop Chrome"] }, testMatch: /anonymous\.spec\.ts/ },
  ],
});
