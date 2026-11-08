import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { ApiError, fail, ok, readJson, toErrorResponse } from "@/lib/api";
import { assertSameOrigin, requireCron } from "@/lib/guard";
import { RedisUnavailableError } from "@/lib/redis/client";
import { RepoError } from "@/lib/redis/repo";
import { SealError } from "@/lib/seal";
import { API_ERROR_CODES } from "@/lib/schema";

const body = async (r: Response) => ({ status: r.status, json: await r.json(), cache: r.headers.get("cache-control") });

describe("response envelope", () => {
  it("ok(): {ok:true,data}, 200 by default, no-store", async () => {
    expect(await body(ok({ a: 1 }))).toEqual({ status: 200, json: { ok: true, data: { a: 1 } }, cache: "no-store" });
    const created = ok("x", { status: 201, headers: { "X-Test": "1" } });
    expect(created.status).toBe(201);
    expect(created.headers.get("x-test")).toBe("1");
    expect(created.headers.get("cache-control")).toBe("no-store");
  });
  it("fail(): maps every code to its HTTP status", async () => {
    const expected: Record<string, number> = {
      UNAUTHENTICATED: 401, FORBIDDEN: 403, BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409, SLUG_TAKEN: 409, REV_MISMATCH: 409,
      RATE_LIMITED: 429, REDIS_UNAVAILABLE: 503, RECOVERY_REQUIRED: 409, PAYLOAD_TOO_LARGE: 413, NOT_CONFIGURED: 501, INTERNAL: 500,
    };
    expect(Object.keys(expected).sort()).toEqual([...API_ERROR_CODES].sort());
    for (const code of API_ERROR_CODES) {
      const r = await body(fail(code, "msg"));
      expect(r.status, code).toBe(expected[code]);
      expect(r.json).toEqual({ ok: false, error: { code, message: "msg" } });
      expect(r.cache).toBe("no-store");
    }
  });
  it("fail() carries details and extra headers", async () => {
    const r = fail("RATE_LIMITED", "slow", { n: 1 }, { "Retry-After": "60" });
    expect(r.headers.get("retry-after")).toBe("60");
    expect((await r.json()).error.details).toEqual({ n: 1 });
  });
});

describe("toErrorResponse", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("maps ApiError, RepoError, RedisUnavailableError and SealError", async () => {
    expect(await body(toErrorResponse(new ApiError("FORBIDDEN", "no", { why: 1 })))).toMatchObject({ status: 403, json: { error: { code: "FORBIDDEN", message: "no", details: { why: 1 } } } });
    expect(await body(toErrorResponse(new RepoError("SLUG_TAKEN", "taken")))).toMatchObject({ status: 409, json: { error: { code: "SLUG_TAKEN" } } });
    expect(await body(toErrorResponse(new RedisUnavailableError()))).toMatchObject({ status: 503, json: { error: { code: "REDIS_UNAVAILABLE" } } });
    expect(await body(toErrorResponse(new SealError("need key")))).toMatchObject({ status: 501, json: { error: { code: "NOT_CONFIGURED", message: "need key" } } });
  });
  it("turns Zod errors into BAD_REQUEST with path/message details", async () => {
    const e = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: { b: 1 } }).error!;
    const r = await body(toErrorResponse(e));
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("BAD_REQUEST");
    expect(r.json.error.details).toEqual([{ path: "a.b", message: expect.any(String) }]);
  });
  it("never leaks internals for unknown errors", async () => {
    const r = await body(toErrorResponse(new Error("connect ECONNREFUSED redis://user:hunter2@host:6379")));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain("hunter2");
    expect(r.json.error).toEqual({ code: "INTERNAL", message: "Something went wrong" });
    expect(spy).toHaveBeenCalledWith("[api] unhandled", "Error"); // class name only, never the message
    expect((await body(toErrorResponse("str"))).status).toBe(500);
  });
});

describe("readJson", () => {
  const req = (text: string, headers: Record<string, string> = {}) => new Request("https://qr.test/x", { method: "POST", body: text, headers });
  it("parses JSON, treating an empty body as {}", async () => {
    expect(await readJson(req('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(req(""))).toEqual({});
  });
  it("rejects invalid JSON with BAD_REQUEST", async () => {
    await expect(readJson(req("{nope"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("rejects oversized bodies by header and by actual size", async () => {
    await expect(readJson(req("{}", { "content-length": "999999" }), 1000)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(readJson(req(JSON.stringify({ s: "x".repeat(2000) })), 1000)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(readJson(req(JSON.stringify({ s: "x".repeat(900) })), 1000)).resolves.toBeTruthy();
  });
});

describe("assertSameOrigin (CSRF)", () => {
  const r = (method: string, headers: Record<string, string> = {}, url = "https://qr.test/api/codes") => new Request(url, { method, headers });
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://qr.test"));
  afterEach(() => vi.unstubAllEnvs());

  it("ignores safe methods", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(() => assertSameOrigin(r(m, { origin: "https://evil.example" }))).not.toThrow();
  });
  it("requires the custom header for unsafe methods", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(() => assertSameOrigin(r(m)), m).toThrowError(expect.objectContaining({ code: "FORBIDDEN", message: "Missing CSRF header" }));
      expect(() => assertSameOrigin(r(m, { "x-qr-csrf": "0" }))).toThrow(ApiError);
    }
  });
  it("accepts same-origin, the configured app origin, and absent Origin", () => {
    expect(() => assertSameOrigin(r("POST", { "x-qr-csrf": "1" }))).not.toThrow();
    expect(() => assertSameOrigin(r("POST", { "x-qr-csrf": "1", origin: "https://qr.test" }))).not.toThrow();
    expect(() => assertSameOrigin(r("POST", { "x-qr-csrf": "1", origin: "https://qr.test" }, "http://internal-host:3000/api/codes"))).not.toThrow();
  });
  it("rejects cross-origin and malformed Origin headers", () => {
    for (const origin of ["https://evil.example", "https://qr.test.evil.example", "http://qr.test", "http://qr.test:8080", "null", "not a url"]) {
      expect(() => assertSameOrigin(r("POST", { "x-qr-csrf": "1", origin })), origin).toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    }
  });
});

describe("requireCron", () => {
  const req = (auth?: string) => new Request("https://qr.test/api/cron/backup", { headers: auth ? { authorization: auth } : {} });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the exact bearer secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect(() => requireCron(req("Bearer s3cret-value"))).not.toThrow();
  });
  it("rejects missing, wrong, truncated, extended and differently-cased credentials", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    for (const a of [undefined, "", "Bearer ", "Bearer wrong", "Bearer s3cret-valu", "Bearer s3cret-value2", "bearer s3cret-value", "s3cret-value", "Basic s3cret-value"]) {
      expect(() => requireCron(req(a)), String(a)).toThrowError(expect.objectContaining({ code: "UNAUTHENTICATED" }));
    }
  });
  it("is NOT_CONFIGURED when no secret is set (never open)", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(() => requireCron(req("Bearer "))).toThrowError(expect.objectContaining({ code: "NOT_CONFIGURED" }));
    expect(() => requireCron(req())).toThrowError(expect.objectContaining({ code: "NOT_CONFIGURED" }));
  });
});

it("bounds streamed JSON by UTF-8 bytes, even without a Content-Length", async () => {
  const req = new Request("https://qr.test/api/codes", { method: "POST", body: JSON.stringify({ text: "😀".repeat(10) }) });
  await expect(readJson(req, 30)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
});
