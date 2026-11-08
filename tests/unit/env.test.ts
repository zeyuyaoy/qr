import { afterEach, expect, it, vi } from "vitest";
import { configReport, env } from "@/lib/env";
afterEach(() => vi.unstubAllEnvs());
it("reports malformed configuration without exposing its values", () => {
  vi.stubEnv("REDIS_URL", "https://private:super-secret@wrong.test");
  vi.stubEnv("DATA_ENCRYPTION_KEY", "too-short-sensitive-key");
  const report = configReport();
  expect(report.issues).toEqual(expect.arrayContaining([expect.stringContaining("REDIS_URL"), expect.stringContaining("DATA_ENCRYPTION_KEY")]));
  expect(JSON.stringify(report)).not.toContain("super-secret");
  expect(JSON.stringify(report)).not.toContain("too-short-sensitive-key");
});
it("production namespaces cannot be overridden and all Vercel deployments disable test authentication", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("QR_KEY_PREFIX", "research:");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("ENABLE_TEST_AUTH", "1");
  expect(env.keyPrefix()).toBe("qr:v1:");
  expect(env.testAuthEnabled()).toBe(false);
});
