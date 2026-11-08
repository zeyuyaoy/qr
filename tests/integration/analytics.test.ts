import { T } from "./helpers/boot";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { dynamicUrl } from "./helpers/fixtures";
import { buildReport } from "@/lib/analytics-report";
import { closeRedis, runScript } from "@/lib/redis/client";
import { K, assertOwnKey, dayKey } from "@/lib/redis/keys";
import { HIT } from "@/lib/redis/scripts";
import { acceptScan, createCode, hit, initMeta, readStats, recentActivity, resetAnalytics, saveSettings, scanCount, visitorKey } from "@/lib/redis/repo";

const rnd = randomBytes(4).toString("hex");
const FOREIGN = [`research:qrtest-${rnd}:foo`, `link:qrtest-${rnd}:x`, `meta:qrtest-${rnd}`, `qr:v1:stats:qrtest${rnd}:20270101`, `qr:v1:count:qrtest${rnd}`];

beforeEach(async () => {
  await T.reset();
  await initMeta();
});
afterAll(async () => {
  const r = await T.raw();
  await r.del(FOREIGN); // exact keys only
  await T.cleanup();
  await closeRedis();
  await T.close();
});

const today = () => dayKey(Date.now());
const accept = (id: string, o: Partial<Parameters<typeof acceptScan>[0]> = {}) => acceptScan({ id, limit: null, analytics: true, retentionDays: 90, device: "mobile", country: "", ...o });

describe("acceptScan", () => {
  it("100 concurrent scans with limit 10: exactly 10 are accepted and the counter is exactly 10", async () => {
    const id = "limitedcode001";
    const res = await Promise.all(Array.from({ length: 100 }, () => accept(id, { limit: 10 })));
    const accepted = res.filter((n): n is number => n !== null);
    expect(accepted).toHaveLength(10);
    expect(accepted.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(res.filter((n) => n === null)).toHaveLength(90);
    expect(await scanCount(id)).toBe(10);
    const [day] = await readStats([today()], id);
    expect(day!.total).toBe(10); // rejected scans leave no trace in the statistics
  });
  it("a limit of 1 hands out exactly one slot", async () => {
    const res = await Promise.all(Array.from({ length: 20 }, () => accept("onlyone000001", { limit: 1 })));
    expect(res.filter((n) => n !== null)).toEqual([1]);
  });
  it("without a limit it counts every scan", async () => {
    const id = "unlimited0001";
    const res = await Promise.all(Array.from({ length: 25 }, () => accept(id)));
    expect(res.every((n) => n !== null)).toBe(true);
    expect(await scanCount(id)).toBe(25);
  });
  it("records per-code and global statistics with a retention TTL", async () => {
    await accept("statscode0001", { device: "mobile", country: "US", retentionDays: 30 });
    await accept("statscode0001", { device: "desktop", retentionDays: 30 });
    await accept("statscode0002", { device: "mobile", retentionDays: 30 });
    const r = await T.raw();
    expect(await r.hGetAll(T.key(`stats:statscode0001:${today()}`))).toEqual({ n: "2", "d:mobile": "1", "d:desktop": "1", "c:US": "1" });
    expect(await r.hGetAll(T.key(`stats:all:${today()}`))).toEqual({ n: "3", "d:mobile": "2", "d:desktop": "1", "c:US": "1", "k:statscode0001": "2", "k:statscode0002": "1" });
    for (const k of [`stats:statscode0001:${today()}`, `stats:all:${today()}`]) {
      const ttl = await r.ttl(T.key(k));
      expect(ttl).toBeGreaterThan(30 * 86_400);
      expect(ttl).toBeLessThanOrEqual(31 * 86_400);
    }
    expect(await r.ttl(T.key(`count:statscode0001`))).toBe(-1); // counters are permanent
  });
  it("omits device and country fields when they are empty", async () => {
    await accept("nodevice00001", { device: "" });
    expect(await (await T.raw()).hGetAll(T.key(`stats:nodevice00001:${today()}`))).toEqual({ n: "1" });
  });
  it("analytics off and no limit: nothing at all is written", async () => {
    const before = await T.dump();
    expect(await accept("silent0000001", { analytics: false })).toBe(0);
    expect(await T.dump()).toEqual(before);
  });
  it("analytics off with a limit: counts toward the limit but writes no statistics", async () => {
    expect(await accept("limitonly0001", { analytics: false, limit: 2 })).toBe(1);
    expect(await accept("limitonly0001", { analytics: false, limit: 2 })).toBe(2);
    expect(await accept("limitonly0001", { analytics: false, limit: 2 })).toBeNull();
    expect((await T.keys()).filter((k) => k.includes(":stats:") || k.endsWith(":recent"))).toEqual([]);
    expect(await scanCount("limitonly0001")).toBe(2);
  });
  it("keeps the recent list capped at 100 entries, newest first", async () => {
    for (let i = 0; i < 130; i++) await accept(`recentcode${String(i).padStart(4, "0")}`);
    expect(await (await T.raw()).lLen(T.key("recent"))).toBe(100);
    const recent = await recentActivity(30);
    expect(recent).toHaveLength(30);
    expect(recent[0]).toMatchObject({ id: "recentcode0129", device: "mobile" });
    expect(recent[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await recentActivity(500)).at(-1)!.id).toBe("recentcode0030");
  });
});

describe("rate-limit buckets", () => {
  it("hit() counts up inside a window and the bucket expires", async () => {
    expect(await hit("t", 60)).toBe(1);
    expect(await hit("t", 60)).toBe(2);
    expect(await hit("other", 60)).toBe(1);
    const keys = (await T.keys()).filter((k) => k.includes(":rl:t:"));
    expect(keys).toHaveLength(1);
    const ttl = await (await T.raw()).ttl(keys[0]!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });
  it("is atomic under concurrency", async () => {
    const res = await Promise.all(Array.from({ length: 40 }, () => hit("race", 600)));
    expect(res.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });
  it("visitorKey is a keyed hash, never the IP", () => {
    const v = visitorKey("203.0.113.9");
    expect(v).toMatch(/^[\w-]{22}$/);
    expect(v).not.toContain("203");
    expect(visitorKey("203.0.113.10")).not.toBe(v);
  });
});

describe("namespace safety", () => {
  it("assertOwnKey accepts our keys and refuses everything else", () => {
    for (const k of [K.code("x"), K.slug("s"), K.meta(), K.rl("a"), K.asset("h"), K.stats("a", "20270101")]) expect(assertOwnKey(k)).toBe(k);
    for (const k of ["research:foo", "link:x", "meta:schema", "qr:v1:code:x", "code:x", "", T.prefix.slice(0, -1)]) expect(() => assertOwnKey(k), k).toThrow(/outside the QR Studio namespace/);
  });
  it("Lua scripts refuse to run on foreign keys", async () => {
    const r = await T.raw();
    await expect(runScript(r as never, "hit-foreign", HIT, ["research:foo"], [60])).rejects.toThrow(/outside the QR Studio namespace/);
    expect(await r.exists("research:foo")).toBe(0);
  });

  const plant = async () => {
    const r = await T.raw();
    await r.set(FOREIGN[0]!, "research-data");
    await r.set(FOREIGN[1]!, "link-data");
    await r.hSet(FOREIGN[2]!, { a: "1" });
    await r.hSet(FOREIGN[3]!, { n: "5" }); // default-namespace look-alike: a different prefix than this test's
    await r.set(FOREIGN[4]!, "9");
    const snapshot = async () => Promise.all([r.get(FOREIGN[0]!), r.get(FOREIGN[1]!), r.hGetAll(FOREIGN[2]!), r.hGetAll(FOREIGN[3]!), r.get(FOREIGN[4]!)]);
    return { before: await snapshot(), snapshot };
  };

  it("resetAnalytics() deletes only our statistics and counters, never foreign keys", async () => {
    const a = await createCode(dynamicUrl({ slug: "reset-all-a" }));
    await accept(a.id);
    await accept(a.id);
    const { before, snapshot } = await plant();
    const deleted = await resetAnalytics();
    expect(deleted).toBeGreaterThanOrEqual(3);
    expect((await T.keys()).filter((k) => /:(stats:|count:|recent$)/.test(k))).toEqual([]);
    expect(await (await T.raw()).exists(T.key(`code:${a.id}`))).toBe(1); // records survive
    expect(await snapshot()).toEqual(before);
  });
  it("resetAnalytics(id) removes one code's data, including its share of the global hashes", async () => {
    const a = await createCode(dynamicUrl({ slug: "reset-one-a" }));
    const b = await createCode(dynamicUrl({ slug: "reset-one-b" }));
    await accept(a.id);
    await accept(a.id);
    await accept(b.id);
    const { before, snapshot } = await plant();
    await resetAnalytics(a.id);
    const r = await T.raw();
    expect(await scanCount(a.id)).toBe(0);
    expect(await scanCount(b.id)).toBe(1);
    expect(await r.exists(T.key(`stats:${a.id}:${today()}`))).toBe(0);
    expect(await r.exists(T.key(`stats:${b.id}:${today()}`))).toBe(1);
    const all = await r.hGetAll(T.key(`stats:all:${today()}`));
    expect(all[`k:${a.id}`]).toBeUndefined();
    expect(all[`k:${b.id}`]).toBe("1");
    expect(await snapshot()).toEqual(before);
  });
  it("resetAnalytics needs an initialised library", async () => {
    await T.reset();
    await expect(resetAnalytics()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
});

describe("buildReport", () => {
  it("aggregates totals, per-day, device, top codes and recent activity", async () => {
    await saveSettings({ analytics: { retentionDays: 30 } });
    const a = await createCode(dynamicUrl({ slug: "report-a", name: "=Menu" }));
    const b = await createCode(dynamicUrl({ slug: "report-b", name: "Promo" }));
    const c = await createCode(dynamicUrl({ slug: "report-c", name: "Paused", enabled: false }));
    for (let i = 0; i < 3; i++) await accept(a.id, { device: "mobile" });
    await accept(b.id, { device: "desktop", country: "DE" });
    const now = new Date();
    const rep = await buildReport(new Date(now.getTime() - 2 * 86_400_000), now);
    expect(rep.totals).toMatchObject({ scans: 4, codes: 3, active: 2, paused: 1 });
    expect(rep.retentionDays).toBe(30);
    expect(rep.devices).toEqual({ mobile: 3, desktop: 1 });
    expect(rep.countries).toEqual({ DE: 1 });
    expect(rep.daily).toHaveLength(3);
    expect(rep.daily.at(-1)).toEqual({ day: `${today().slice(0, 4)}-${today().slice(4, 6)}-${today().slice(6, 8)}`, scans: 4 });
    expect(rep.top.map((t) => [t.name, t.scans])).toEqual([["=Menu", 3], ["Promo", 1]]);
    expect(rep.recent).toHaveLength(4);
    expect(rep.recent[0]!.name).toBe("Promo");
    const one = await buildReport(new Date(now.getTime() - 86_400_000), now, a.id);
    expect(one.totals.scans).toBe(3);
    expect(one.recent).toEqual([]);
    expect(c.id).toBeTruthy();
  });
});
