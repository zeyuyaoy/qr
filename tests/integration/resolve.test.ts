import { T } from "./helpers/boot";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEST, dynamicUrl } from "./helpers/fixtures";
import { handleResolve } from "@/lib/resolve";
import { closeRedis } from "@/lib/redis/client";
import { GET, HEAD, POST } from "@/app/r/[slug]/route";
import { acceptScan, createCode, getCode, initMeta, saveSettings, scanCount, updateCode } from "@/lib/redis/repo";
import { dayKey } from "@/lib/redis/keys";
import { defaultSettings } from "@/lib/schema";

beforeEach(async () => {
  vi.unstubAllEnvs();
  await T.reset();
  await initMeta();
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await T.cleanup();
  await closeRedis();
  await T.close();
});

const get = (slug: string, init: RequestInit = {}) => handleResolve(new Request(`https://qr.test/r/${slug}`, init), slug);
const ip = (addr: string) => ({ headers: { "x-real-ip": addr } });
const postPw = (slug: string, password: string, headers: Record<string, string> = {}) =>
  handleResolve(new Request(`https://qr.test/r/${slug}`, { method: "POST", body: new URLSearchParams({ password }), headers: { "x-real-ip": "198.51.100.1", ...headers } }), slug);
const statKeys = async () => (await T.keys()).filter((k) => /:stats:|:recent$/.test(k));
const text = (r: Response) => r.text();

it("rejects a stale scan after an edit or password change, even with analytics off", async () => {
  const rec = await createCode(dynamicUrl({ analytics: false }));
  await updateCode(rec.id, { enabled: false });
  await expect(acceptScan({ id: rec.id, limit: null, analytics: false, retentionDays: 90, expectedRev: rec.rev })).rejects.toThrow(/Link changed/);
  expect(await scanCount(rec.id)).toBe(0);
});

it("rejects expiry crossed during password hashing without claiming a scan", async () => {
  const rec = await createCode(dynamicUrl());
  await expect(acceptScan({ id: rec.id, limit: 1, analytics: true, retentionDays: 90, expectedRev: rec.rev, expiresAt: Date.now() - 1 })).rejects.toThrow(/Link changed/);
  expect(await scanCount(rec.id)).toBe(0);
});

describe("successful redirect", () => {
  it("is a 307 with no-store and the destination byte-for-byte (query + fragment)", async () => {
    await createCode(dynamicUrl({ slug: "go-here" }));
    const res = await get("go-here");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(DEST);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(res.body).toBeNull();
  });
  it.each([
    "https://example.com/a%2Fb?x=1&y=2#frag%C3%A9",
    "https://Example.com:8443/path/../x?q=a+b&r=%E2%9C%93&empty=#",
    "http://example.org/?next=https%3A%2F%2Fother.example%2F",
  ])("keeps %s exactly", async (dest) => {
    await createCode(dynamicUrl({ slug: "exact-1", payload: dest }));
    expect((await get("exact-1")).headers.get("location")).toBe(dest);
  });
  it("is case-insensitive on the slug", async () => {
    await createCode(dynamicUrl({ slug: "mixed-case" }));
    expect((await get("MiXeD-CaSe")).status).toBe(307);
  });
  it("counts the accepted scan and records analytics", async () => {
    const rec = await createCode(dynamicUrl({ slug: "counted" }));
    await get("counted", { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" } });
    expect(await scanCount(rec.id)).toBe(1);
    const h = await (await T.raw()).hGetAll(T.key(`stats:all:${dayKey(Date.now())}`));
    expect(h).toMatchObject({ n: "1", "d:mobile": "1", [`k:${rec.id}`]: "1" });
  });
  it("is served by the real route module (GET and HEAD exports)", async () => {
    await createCode(dynamicUrl({ slug: "via-route" }));
    const ctx = { params: Promise.resolve({ slug: "via-route" }) };
    expect((await GET(new Request("https://qr.test/r/via-route"), ctx)).status).toBe(307);
    expect((await HEAD(new Request("https://qr.test/r/via-route", { method: "HEAD" }), ctx)).status).toBe(307);
    expect((await POST(new Request("https://qr.test/r/via-route", { method: "POST" }), ctx)).status).toBe(405);
  });
});

describe("HEAD", () => {
  it("returns the redirect but never counts a scan", async () => {
    const rec = await createCode(dynamicUrl({ slug: "head-1" }));
    const res = await get("head-1", { method: "HEAD" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(DEST);
    expect(await scanCount(rec.id)).toBe(0);
    expect(await statKeys()).toEqual([]);
  });
  it("does not consume a limited link", async () => {
    await createCode(dynamicUrl({ slug: "head-lim", scanLimit: 1 }));
    for (let i = 0; i < 5; i++) expect((await get("head-lim", { method: "HEAD" })).status).toBe(307);
    expect((await get("head-lim")).status).toBe(307);
    expect((await get("head-lim")).status).toBe(410);
  });
});

describe("missing links", () => {
  it("404 with a 'not found' page for unknown and malformed slugs", async () => {
    for (const slug of ["nothing-here", "ab", "-bad", "x".repeat(70), "has space", "a%2fb", "UPPER-but-missing"]) {
      const res = await get(slug);
      expect(res.status, slug).toBe(404);
      expect(await text(res)).toContain("Link not found");
      expect(res.headers.get("location")).toBeNull();
    }
  });
  it("503 'unavailable' (not 404) when the library looks wiped, 404 once initialised", async () => {
    await createCode(dynamicUrl({ slug: "was-here" }));
    await T.reset(); // Redis lost its data
    const wiped = await get("was-here");
    expect(wiped.status).toBe(503);
    expect(wiped.headers.get("retry-after")).toBe("300");
    const body = await text(wiped);
    expect(body).toContain("Temporarily unavailable");
    expect(body).not.toContain("Link not found");
    await initMeta();
    expect((await get("was-here")).status).toBe(404);
  });
  it("rate-limits repeated misses per visitor (429 after 60)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-06-01T12:05:00Z")); // mid-window so the 10 minute bucket cannot roll over
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await get("no-such-link", ip("203.0.113.5"))).status;
    expect(last).toBe(429);
    expect((await get("no-such-link", ip("203.0.113.6"))).status).toBe(404); // another visitor is unaffected
  });
});

describe("link states", () => {
  it("paused (disabled) -> 403", async () => {
    await createCode(dynamicUrl({ slug: "paused-1", enabled: false }));
    const res = await get("paused-1");
    expect([res.status, await text(res)].join("|")).toMatch(/^403\|.*Link paused/s);
  });
  it("archived -> 403 paused", async () => {
    await createCode(dynamicUrl({ slug: "archived-1", status: "archived" }));
    expect((await get("archived-1")).status).toBe(403);
  });
  it("not yet active -> 403 with the start time", async () => {
    await createCode(dynamicUrl({ slug: "later-1", schedule: { activateAt: "2099-01-01T00:00:00Z", expiresAt: null, expireAfterSeconds: null } }));
    const res = await get("later-1");
    expect(res.status).toBe(403);
    const body = await text(res);
    expect(body).toContain("Not active yet");
    expect(body).toContain("Thu, 01 Jan 2099 00:00:00 GMT");
  });
  it("expired -> 410 with the expired page", async () => {
    await createCode(dynamicUrl({ slug: "expired-1", schedule: { activateAt: null, expiresAt: "2020-01-01T00:00:00Z", expireAfterSeconds: null } }));
    const res = await get("expired-1");
    expect(res.status).toBe(410);
    expect(await text(res)).toContain("This link has expired");
  });
  it("scan limit reached -> 410 with a different page than expiry", async () => {
    await createCode(dynamicUrl({ slug: "limit-2", scanLimit: 2 }));
    expect((await get("limit-2")).status).toBe(307);
    expect((await get("limit-2")).status).toBe(307);
    const res = await get("limit-2");
    expect(res.status).toBe(410);
    const body = await text(res);
    expect(body).toContain("Scan limit reached");
    expect(body).not.toContain("This link has expired");
  });
  it("trashed -> 404 'removed' (distinct from 'not found')", async () => {
    const rec = await createCode(dynamicUrl({ slug: "trashed-1" }));
    await updateCode(rec.id, { status: "trashed" });
    const res = await get("trashed-1");
    expect(res.status).toBe(404);
    const body = await text(res);
    expect(body).toContain("Link removed");
    expect(body).not.toContain("Link not found");
  });
  it("refusals are never counted", async () => {
    const rec = await createCode(dynamicUrl({ slug: "refused-1", enabled: false }));
    await get("refused-1");
    expect(await scanCount(rec.id)).toBe(0);
    expect(await statKeys()).toEqual([]);
  });
  it("relative expiry flips exactly at createdAt + duration", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-06-01T12:00:00Z"));
    await createCode(dynamicUrl({ slug: "relative-1", schedule: { activateAt: null, expiresAt: null, expireAfterSeconds: 3600 } }));
    vi.setSystemTime(new Date("2027-06-01T12:59:59.999Z"));
    expect((await get("relative-1")).status).toBe(307);
    vi.setSystemTime(new Date("2027-06-01T13:00:00.000Z"));
    expect((await get("relative-1")).status).toBe(410);
  });
  it("scheduled activation flips exactly at activateAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-06-01T12:00:00Z"));
    await createCode(dynamicUrl({ slug: "sched-1", schedule: { activateAt: "2027-06-02T00:00:00Z", expiresAt: "2027-06-03T00:00:00Z", expireAfterSeconds: null } }));
    expect((await get("sched-1")).status).toBe(403);
    vi.setSystemTime(new Date("2027-06-02T00:00:00.000Z"));
    expect((await get("sched-1")).status).toBe(307);
    vi.setSystemTime(new Date("2027-06-03T00:00:00.000Z"));
    expect((await get("sched-1")).status).toBe(410);
  });
});

describe("replacement redirect after expiry", () => {
  const REPLACEMENT = "https://example.com/new-offer?src=qr#top";
  it("expired -> 307 to the replacement, uncounted", async () => {
    const rec = await createCode(dynamicUrl({ slug: "replace-1", schedule: { activateAt: null, expiresAt: "2020-01-01T00:00:00Z", expireAfterSeconds: null }, afterExpiry: { message: null, redirectUrl: REPLACEMENT } }));
    const res = await get("replace-1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(REPLACEMENT);
    expect(await scanCount(rec.id)).toBe(0);
  });
  it("scan-limit exhaustion also uses the replacement", async () => {
    await createCode(dynamicUrl({ slug: "replace-2", scanLimit: 1, afterExpiry: { message: null, redirectUrl: REPLACEMENT } }));
    expect((await get("replace-2")).headers.get("location")).toBe(DEST);
    expect((await get("replace-2")).headers.get("location")).toBe(REPLACEMENT);
  });
  it("a custom expiry message is shown when there is no replacement", async () => {
    await createCode(dynamicUrl({ slug: "msg-1", schedule: { activateAt: null, expiresAt: "2020-01-01T00:00:00Z", expireAfterSeconds: null }, afterExpiry: { message: "Sale ended, thanks!", redirectUrl: null } }));
    expect(await text(await get("msg-1"))).toContain("Sale ended, thanks!");
  });
  it("is not used for paused or removed links", async () => {
    await createCode(dynamicUrl({ slug: "replace-3", enabled: false, afterExpiry: { message: null, redirectUrl: REPLACEMENT } }));
    const res = await get("replace-3");
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("analytics switches", () => {
  const writes = async () => ({ stats: await statKeys(), counts: (await T.keys()).filter((k) => k.includes(":count:")) });

  it("per-code opt-out writes nothing", async () => {
    await createCode(dynamicUrl({ slug: "optout-1", analytics: false }));
    expect((await get("optout-1")).status).toBe(307);
    expect(await writes()).toEqual({ stats: [], counts: [] });
  });
  it("global opt-out writes nothing for any code", async () => {
    await saveSettings({ analytics: { enabled: false } });
    await createCode(dynamicUrl({ slug: "optout-2" }));
    expect((await get("optout-2")).status).toBe(307);
    expect(await writes()).toEqual({ stats: [], counts: [] });
  });
  it("a scan limit still counts when analytics are off, without statistics", async () => {
    const rec = await createCode(dynamicUrl({ slug: "optout-3", analytics: false, scanLimit: 3 }));
    await get("optout-3");
    expect(await scanCount(rec.id)).toBe(1);
    expect(await statKeys()).toEqual([]);
  });
  it("no device breakdown when devices are disabled", async () => {
    await saveSettings({ analytics: { devices: false } });
    await createCode(dynamicUrl({ slug: "nodev-1" }));
    await get("nodev-1", { headers: { "user-agent": "Mozilla/5.0 (iPhone)" } });
    const h = await (await T.raw()).hGetAll(T.key(`stats:all:${dayKey(Date.now())}`));
    expect(Object.keys(h).filter((k) => k.startsWith("d:"))).toEqual([]);
  });
  it("country is recorded only with geo enabled, on Vercel, and for a valid header", async () => {
    await createCode(dynamicUrl({ slug: "geo-1" }));
    const country = async () => Object.keys(await (await T.raw()).hGetAll(T.key(`stats:all:${dayKey(Date.now())}`))).filter((k) => k.startsWith("c:"));
    await get("geo-1", { headers: { "x-vercel-ip-country": "US" } });
    expect(await country()).toEqual([]); // geo disabled by default
    await saveSettings({ analytics: { geo: true } });
    await get("geo-1", { headers: { "x-vercel-ip-country": "US" } });
    expect(await country()).toEqual([]); // headers not trusted off-Vercel
    vi.stubEnv("VERCEL", "1");
    await get("geo-1", { headers: { "x-vercel-ip-country": "us" } });
    await get("geo-1", { headers: { "x-vercel-ip-country": "<script>" } });
    expect(await country()).toEqual([]);
    await get("geo-1", { headers: { "x-vercel-ip-country": "DE" } });
    expect(await country()).toEqual(["c:DE"]);
  });
  it("uses the brand from settings on public pages", async () => {
    await saveSettings({ brand: { name: "Acme <b>Corp</b>", expiredTitle: "Gone" } });
    await createCode(dynamicUrl({ slug: "brand-1", schedule: { activateAt: null, expiresAt: "2020-01-01T00:00:00Z", expireAfterSeconds: null } }));
    const body = await text(await get("brand-1"));
    expect(body).toContain("Gone");
    expect(body).toContain("Acme &lt;b&gt;Corp&lt;/b&gt;");
    expect(body).not.toContain("<b>Corp");
  });
});

describe("concurrency", () => {
  it("100 concurrent scans of a link limited to 10: exactly 10 redirects, 90 'limit reached', counter 10", async () => {
    const rec = await createCode(dynamicUrl({ slug: "stampede", scanLimit: 10 }));
    const res = await Promise.all(Array.from({ length: 100 }, () => get("stampede")));
    const by = (s: number) => res.filter((r) => r.status === s).length;
    expect(by(307)).toBe(10);
    expect(by(410)).toBe(90);
    expect(res.length).toBe(by(307) + by(410));
    expect(await scanCount(rec.id)).toBe(10);
  });
});

describe("destination is re-validated at redirect time", () => {
  const tamper = async (id: string, payload: string) => {
    const r = await T.raw();
    const rec = JSON.parse((await r.get(T.key(`code:${id}`)))!);
    await r.set(T.key(`code:${id}`), JSON.stringify({ ...rec, payload }));
  };
  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "https://qr.test/r/loop", "file:///etc/passwd", "https://user:pw@example.com/"])(
    "502 'misconfigured' for tampered payload %s",
    async (bad) => {
      const rec = await createCode(dynamicUrl({ slug: "tamper-1" }));
      await tamper(rec.id, bad);
      const res = await get("tamper-1");
      expect(res.status).toBe(502);
      expect(res.headers.get("location")).toBeNull();
      expect(await text(res)).toContain("Link misconfigured");
      expect(await scanCount(rec.id)).toBe(0);
    },
  );
  it("a tampered replacement URL is not followed", async () => {
    const rec = await createCode(dynamicUrl({ slug: "tamper-2", schedule: { activateAt: null, expiresAt: "2020-01-01T00:00:00Z", expireAfterSeconds: null }, afterExpiry: { message: null, redirectUrl: "https://example.com/ok" } }));
    const r = await T.raw();
    const stored = JSON.parse((await r.get(T.key(`code:${rec.id}`)))!);
    await r.set(T.key(`code:${rec.id}`), JSON.stringify({ ...stored, afterExpiry: { message: null, redirectUrl: "javascript:alert(1)" } }));
    const res = await get("tamper-2");
    expect(res.status).toBe(410);
    expect(res.headers.get("location")).toBeNull();
  });
  it("a record that no longer parses never redirects", async () => {
    const rec = await createCode(dynamicUrl({ slug: "garbage-1" }));
    await (await T.raw()).set(T.key(`code:${rec.id}`), "{not json");
    const res = await get("garbage-1");
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("password gate", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-06-01T12:05:00Z")); // rate-limit windows cannot roll over mid-test
  });

  it("GET renders the form (200), reveals nothing and counts nothing", async () => {
    const rec = await createCode(dynamicUrl({ slug: "locked-1", password: "open-sesame" }));
    const res = await get("locked-1");
    expect(res.status).toBe(200);
    const body = await text(res);
    expect(body).toContain("Password required");
    expect(body).toContain('action="/r/locked-1"');
    expect(body).not.toContain("example.com");
    expect(res.headers.get("location")).toBeNull();
    expect(await scanCount(rec.id)).toBe(0);
    expect(await statKeys()).toEqual([]);
  });
  it("HEAD does not leak the destination either", async () => {
    await createCode(dynamicUrl({ slug: "locked-head", password: "open-sesame" }));
    const res = await get("locked-head", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
  it("wrong password -> 401, form shown again with an error, not counted", async () => {
    const rec = await createCode(dynamicUrl({ slug: "locked-2", password: "open-sesame" }));
    for (const bad of ["wrong", "", "open-sesamE", "x".repeat(129)]) {
      const res = await postPw("locked-2", bad);
      expect(res.status, bad).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      if (bad !== "") expect(await text(res)).toContain("Incorrect password.");
    }
    expect(await scanCount(rec.id)).toBe(0);
    expect(await statKeys()).toEqual([]);
  });
  it("right password -> 303 to the destination and exactly one counted scan", async () => {
    const rec = await createCode(dynamicUrl({ slug: "locked-3", password: "open-sesame" }));
    const res = await postPw("locked-3", "open-sesame");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(DEST);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(await scanCount(rec.id)).toBe(1);
  });
  it("counts toward the scan limit only on success", async () => {
    await createCode(dynamicUrl({ slug: "locked-4", password: "open-sesame", scanLimit: 1 }));
    await postPw("locked-4", "nope");
    expect((await postPw("locked-4", "open-sesame")).status).toBe(303);
    expect((await postPw("locked-4", "open-sesame")).status).toBe(410);
    expect((await get("locked-4")).status).toBe(410); // exhausted is shown before the gate
  });
  it("rejects cross-origin form posts", async () => {
    const rec = await createCode(dynamicUrl({ slug: "locked-5", password: "open-sesame" }));
    const res = await postPw("locked-5", "open-sesame", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await scanCount(rec.id)).toBe(0);
    expect((await postPw("locked-5", "open-sesame", { origin: "https://qr.test" })).status).toBe(303);
  });
  it("throttles guessing: the 9th attempt from one visitor is 429, even with the right password", async () => {
    await createCode(dynamicUrl({ slug: "locked-6", password: "open-sesame" }));
    for (let i = 1; i <= 8; i++) expect((await postPw("locked-6", `guess${i}`)).status, `attempt ${i}`).toBe(401);
    const blocked = await postPw("locked-6", "open-sesame");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("600");
    expect(await text(blocked)).toContain("Too many attempts");
    expect((await postPw("locked-6", "open-sesame", { "x-real-ip": "198.51.100.77" })).status).toBe(303); // someone else is fine
  });
  it("also throttles per link across visitors (more than 80 attempts an hour)", async () => {
    await createCode(dynamicUrl({ slug: "locked-7", password: "open-sesame" }));
    let status = 0;
    for (let i = 0; i < 81; i++) status = (await postPw("locked-7", "wrong", { "x-real-ip": `198.51.100.${i % 250}.`.replace(/\.$/, "") })).status;
    expect(status).toBe(429);
  });
  it("POST to a link without a password is 405", async () => {
    await createCode(dynamicUrl({ slug: "open-post" }));
    const res = await postPw("open-post", "x");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
  it("never writes a raw IP address (or any user agent) into Redis", async () => {
    const IP = "203.0.113.77";
    await createCode(dynamicUrl({ slug: "locked-8", password: "open-sesame" }));
    await get("no-such", ip(IP)); // miss bucket
    await postPw("locked-8", "wrong", { "x-real-ip": IP }); // password buckets
    await postPw("locked-8", "open-sesame", { "x-real-ip": IP }); // accepted scan
    await get("locked-8", { headers: { "x-forwarded-for": `${IP}, 10.0.0.1`, "user-agent": "SecretAgent/1.0" } });
    const keys = await T.keys();
    expect(keys.some((k) => k.includes(":rl:pw:"))).toBe(true);
    expect(keys.some((k) => k.includes(":rl:miss:"))).toBe(true);
    const everything = JSON.stringify(await T.dump()) + keys.join("\n");
    expect(everything).not.toContain(IP);
    expect(everything).not.toContain("SecretAgent");
    expect(everything).not.toContain("10.0.0.1");
  });
});

describe("static settings are honoured by the resolver", () => {
  it("falls back to defaults when settings are missing or unreadable", async () => {
    await createCode(dynamicUrl({ slug: "nosettings", schedule: { activateAt: null, expiresAt: "2020-01-01T00:00:00Z", expireAfterSeconds: null } }));
    await (await T.raw()).set(T.key("settings"), "{broken");
    await expect(get("nosettings")).resolves.toMatchObject({ status: 503 }); // unparsable JSON in settings fails closed
    await (await T.raw()).set(T.key("settings"), JSON.stringify({ v: 1, brand: { accent: "nope" } }));
    const res = await get("nosettings");
    expect(res.status).toBe(410);
    expect(await text(res)).toContain(defaultSettings().brand.expiredTitle);
  });
  it("record updates are visible immediately (no stale redirect)", async () => {
    const rec = await createCode(dynamicUrl({ slug: "live-edit" }));
    expect((await get("live-edit")).headers.get("location")).toBe(DEST);
    await updateCode(rec.id, { payload: "https://example.org/changed" });
    expect((await get("live-edit")).headers.get("location")).toBe("https://example.org/changed");
    await updateCode(rec.id, { enabled: false });
    expect((await get("live-edit")).status).toBe(403);
    expect((await getCode(rec.id))!.rev).toBe(3);
  });
});
