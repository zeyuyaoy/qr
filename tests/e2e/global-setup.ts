import { mkdirSync } from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "redis";

/** Wipes ONLY this E2E run's namespace on the disposable DB 5, initialises the library, and stores a signed-in session. */
export default async function globalSetup(config: FullConfig) {
  const url = process.env.E2E_REDIS_URL ?? "redis://localhost:6390/5";
  if (!/^redis:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) throw new Error("E2E refuses to run against a non-local Redis");
  const r = createClient({ url });
  await r.connect();
  let cursor = "0";
  do {
    const res = await r.scan(cursor, { MATCH: "qr:v1:*", COUNT: 500 });
    cursor = res.cursor;
    if (res.keys.length) await r.unlink(res.keys);
  } while (cursor !== "0");
  await r.set("qr:v1:meta:schema", JSON.stringify({ schemaVersion: 1, initializedAt: new Date().toISOString(), instanceId: "e2e" }));
  await r.quit();

  mkdirSync("tests/e2e/.auth", { recursive: true });
  const base = config.projects[0]!.use.baseURL!;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Obtain a session through the real Auth.js credentials endpoint (test provider is disabled in production).
  const csrf = await (await page.request.get(`${base}/api/auth/csrf`)).json();
  const res = await page.request.post(`${base}/api/auth/callback/test`, {
    form: { csrfToken: csrf.csrfToken, email: "owner@example.test", secret: "e2e-test-auth-secret", json: "true" },
  });
  if (!res.ok()) throw new Error(`test sign-in failed (${res.status()})`);
  await page.context().storageState({ path: "tests/e2e/.auth/owner.json" });
  await browser.close();
}
