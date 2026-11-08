import { T } from "./helpers/boot";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeGithub, type FakeGithub } from "./helpers/github-fake";
import { seedLibrary } from "./helpers/seed";
import { dynamicUrl } from "./helpers/fixtures";
import { STALE_AFTER_MS, backupConfigured, freshness, listSnapshots, readStatus, restoreFrom, runBackup } from "@/lib/backup/run";
import { GithubError, fetchRemote, listRemote, snapshotName } from "@/lib/backup/github";
import { unpackSnapshot } from "@/lib/backup/snapshot";
import { closeRedis } from "@/lib/redis/client";
import { createCode, getMeta, initMeta, listCodes, updateCode } from "@/lib/redis/repo";

let gh: FakeGithub;
const configure = () => {
  vi.stubEnv("BACKUP_GITHUB_REPO", "owner/repo");
  vi.stubEnv("BACKUP_GITHUB_TOKEN", "ghp_faketoken123");
};

beforeEach(async () => {
  vi.unstubAllEnvs();
  await T.reset();
  gh = installFakeGithub();
  configure();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await T.cleanup();
  await closeRedis();
  await T.close();
});

const NAME = /^qr-\d{8}T\d{6}Z-[a-f0-9]{8}\.qrbackup\.json$/;
const withData = async () => {
  await initMeta();
  return seedLibrary();
};

describe("configuration", () => {
  it("backupConfigured needs repo, token and a backup key", () => {
    expect(backupConfigured()).toBe(true);
    vi.stubEnv("BACKUP_ENCRYPTION_KEY", "");
    expect(backupConfigured()).toBe(false);
    vi.stubEnv("BACKUP_ENCRYPTION_KEY", T.backupKey);
    vi.stubEnv("BACKUP_GITHUB_TOKEN", "");
    expect(backupConfigured()).toBe(false);
  });
  it("not configured -> a failed run is recorded (and nothing is uploaded)", async () => {
    await withData();
    vi.stubEnv("BACKUP_GITHUB_REPO", "");
    const run = await runBackup("manual");
    expect(run).toMatchObject({ outcome: "failed", trigger: "manual", error: expect.stringContaining("not configured") });
    expect(gh.fetch).not.toHaveBeenCalled();
    const st = await readStatus();
    expect(st.history).toHaveLength(1);
    expect(st).toMatchObject({ lastSuccessAt: null, lastAttemptAt: run.at });
  });
  it("rejects a malformed repository name", async () => {
    await withData();
    vi.stubEnv("BACKUP_GITHUB_REPO", "not a repo");
    const run = await runBackup("cron");
    expect(run).toMatchObject({ outcome: "failed", error: expect.stringContaining("owner/name") });
    await expect(listRemote()).rejects.toThrow(GithubError);
  });
});

describe("uninitialised Redis", () => {
  it("is skipped and never uploads an empty snapshot over good history", async () => {
    gh.seed("qr-20260101T000000Z-aaaaaaaa.qrbackup.json", "precious");
    const run = await runBackup("cron");
    expect(run).toMatchObject({ outcome: "skipped", error: expect.stringContaining("not initialised") });
    expect(gh.puts()).toBe(0);
    expect(gh.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(gh.names()).toEqual(["qr-20260101T000000Z-aaaaaaaa.qrbackup.json"]);
    expect(await getMeta()).toBeNull(); // the run did not initialise anything
    expect((await readStatus()).lastSuccessAt).toBeNull();
    expect((await readStatus()).history[0]).toMatchObject({ outcome: "skipped" });
  });
});

describe("created / unchanged", () => {
  it("marks an incomplete snapshot as failed and preserves good remote history", async () => {
    const seeded = await withData();
    const first = await runBackup("manual");
    await (await T.raw()).set(T.key(`code:${seeded.alpha.id}`), "{broken");
    const run = await runBackup("cron");
    expect(run.outcome).toBe("failed");
    expect(run.error).toMatch(/incomplete backup refused/);
    expect(gh.names()).toEqual([first.name]);
    expect((await readStatus()).lastSuccessAt).toBe(first.at);
  });
  it("uploads an encrypted, restorable snapshot", async () => {
    await withData();
    const run = await runBackup("manual");
    expect(run).toMatchObject({ outcome: "created", records: 6, pruned: 0, trigger: "manual" });
    expect(run.name).toMatch(NAME);
    expect(gh.names()).toEqual([run.name]);
    const file = gh.files.get(`snapshots/${run.name}`)!.content;
    expect(run.bytes).toBe(file.length);
    expect(file).not.toContain("bk-alpha");
    expect(file).not.toContain("secret-destination");
    const { snapshot } = unpackSnapshot(file, T.backupKey);
    expect(snapshot.codes).toHaveLength(6);
    const st = await readStatus();
    expect(st.lastSuccessAt).toBe(run.at);
    expect(await (await T.raw()).exists(T.key("backup:lock"))).toBe(0); // lock released
  });
  it("sends the token and API version, and never the key", async () => {
    await withData();
    await runBackup("manual");
    const put = gh.calls.find((c) => c.method === "PUT")!;
    expect(put.headers.Authorization).toBe("Bearer ghp_faketoken123");
    expect(put.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(JSON.stringify(gh.calls)).not.toContain(T.backupKey);
  });
  it("same content again -> 'unchanged', no new file", async () => {
    await withData();
    const first = await runBackup("cron");
    const second = await runBackup("cron");
    expect(second).toMatchObject({ outcome: "unchanged", name: first.name, records: 6 });
    expect(gh.puts()).toBe(1);
    expect(gh.names()).toHaveLength(1);
    expect((await readStatus()).lastSuccessAt).toBe(second.at);
  });
  it("a change (even only to statistics) produces a new file", async () => {
    const s = await withData();
    const first = await runBackup("cron");
    await updateCode(s.alpha.id, { name: "Renamed" });
    vi.useFakeTimers({ toFake: ["Date"] }); // the file name carries a one-second timestamp
    vi.setSystemTime(Date.now() + 5000);
    const second = await runBackup("cron");
    expect(second.outcome).toBe("created");
    expect(second.name).not.toBe(first.name);
    expect(gh.names()).toHaveLength(2);
  });
  it("reports unreadable records as a failed backup", async () => {
    const s = await withData();
    await (await T.raw()).set(T.key(`code:${s.eps.id}`), "{broken");
    const run = await runBackup("manual");
    expect(run).toMatchObject({ outcome: "failed", error: expect.stringContaining("incomplete backup refused") });
    expect(gh.puts()).toBe(0);
  });
  it("keeps at most 30 history entries", async () => {
    await withData();
    for (let i = 0; i < 33; i++) await runBackup("cron");
    const st = await readStatus();
    expect(st.history).toHaveLength(30);
  }, 60_000);
});

describe("retention", () => {
  const day = 86_400_000;
  const fileName = (t: number, h = "deadbeef") => snapshotName(new Date(t).toISOString(), h.padEnd(8, "0").slice(0, 8));

  it("prunes old snapshots after a new one is created (at most 25 per run), never the newest", async () => {
    await withData();
    const now = Date.now();
    const old = Array.from({ length: 70 }, (_, i) => fileName(now - (i + 1) * day, i.toString(16).padStart(8, "0")));
    old.forEach((n) => gh.seed(n));
    const run = await runBackup("cron");
    expect(run.outcome).toBe("created");
    const remaining = gh.names();
    expect(run.pruned).toBe(25);
    expect(remaining).toHaveLength(70 + 1 - 25);
    expect(remaining).toContain(run.name);
    const newest = [...old, run.name!].sort().at(-1)!;
    expect(remaining).toContain(newest);
    // the 30 newest are all still there
    expect([...old, run.name!].sort().slice(-30).every((n) => remaining.includes(n))).toBe(true);
    // only old files were deleted, and the delete calls carried the right sha (the fake rejects mismatches)
    const deleted = old.filter((n) => !remaining.includes(n));
    expect(deleted).toHaveLength(25);
    expect(deleted.every((n) => n < [...old, run.name!].sort().slice(-30)[0]!)).toBe(true);
    expect(gh.calls.filter((c) => c.method === "DELETE")).toHaveLength(25);
  });
  it("a failed prune never fails the backup", async () => {
    await withData();
    const now = Date.now();
    for (let i = 0; i < 40; i++) gh.seed(fileName(now - (i + 1) * day, i.toString(16)));
    const orig = gh.fetch.getMockImplementation()!;
    gh.fetch.mockImplementation(async (input, init) => (init?.method === "DELETE" ? new Response("forbidden", { status: 403 }) : orig(input, init)));
    const run = await runBackup("cron");
    expect(run).toMatchObject({ outcome: "created", pruned: 0 });
    expect(gh.names()).toHaveLength(41);
  });
});

describe("failures are recorded, not thrown", () => {
  it("GitHub rate limit (403 + x-ratelimit-remaining: 0) on upload", async () => {
    await withData();
    gh.mode.rateLimit = "PUT";
    const run = await runBackup("cron");
    expect(run.outcome).toBe("failed");
    expect(run.error).toMatch(/rate limit/i);
    expect(run.error).toMatch(/retry in \d+s/);
    const st = await readStatus();
    expect(st.history[0]).toMatchObject({ outcome: "failed" });
    expect(st.lastSuccessAt).toBeNull();
    expect(st.lastAttemptAt).toBe(run.at);
    expect(gh.names()).toEqual([]);
    expect(await (await T.raw()).exists(T.key("backup:lock"))).toBe(0);
  });
  it("rate limit while listing", async () => {
    await withData();
    gh.mode.rateLimit = "GET";
    expect(await runBackup("cron")).toMatchObject({ outcome: "failed", error: expect.stringMatching(/rate limit/i) });
  });
  it("GitHub 5xx (after retries) is a recorded failure and keeps the previous success time", async () => {
    await withData();
    const ok = await runBackup("cron");
    expect(ok.outcome).toBe("created");
    gh.mode.serverError = "*";
    const run = await runBackup("cron");
    expect(run).toMatchObject({ outcome: "failed", error: expect.stringContaining("(500)") });
    const st = await readStatus();
    expect(st.lastSuccessAt).toBe(ok.at);
    expect(st.history.map((h) => h.outcome)).toEqual(["failed", "created"]);
    expect(gh.calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(4); // initial + 2 retries
  }, 30_000);
  it("network failure", async () => {
    await withData();
    gh.mode.networkDown = true;
    expect(await runBackup("cron")).toMatchObject({ outcome: "failed", error: "Could not reach GitHub" });
  }, 30_000);
  it("401 / 404 produce actionable hints", async () => {
    await withData();
    gh.fetch.mockImplementation(async () => new Response("bad credentials", { status: 401 }));
    expect(await runBackup("cron")).toMatchObject({ outcome: "failed", error: expect.stringContaining("token invalid or expired") });
    gh.fetch.mockImplementation(async (_u, init) => (init?.method === "PUT" ? new Response("", { status: 404 }) : new Response("", { status: 404 })));
    const run = await runBackup("cron");
    expect(run.outcome).toBe("failed");
    expect(run.error).toContain("repository, branch or path not found");
  });
  it("truncates very long error messages", async () => {
    await withData();
    gh.fetch.mockImplementation(async () => new Response("x".repeat(5000), { status: 422 }));
    const run = await runBackup("cron");
    expect(run.error!.length).toBeLessThanOrEqual(300);
  });
});

describe("locking", () => {
  it("skips (without recording or touching) when another backup holds the lock", async () => {
    await withData();
    const r = await T.raw();
    await r.set(T.key("backup:lock"), "other-run", { EX: 300 });
    const run = await runBackup("cron");
    expect(run).toMatchObject({ outcome: "skipped", error: "Another backup is already running" });
    expect(gh.fetch).not.toHaveBeenCalled();
    expect(await r.get(T.key("backup:lock"))).toBe("other-run"); // someone else's lock is left alone
    expect((await readStatus()).history).toEqual([]);
  });
  it("two simultaneous runs: one uploads, the other is skipped; only one file exists", async () => {
    await withData();
    gh.mode.delayMs = 40;
    const runs = await Promise.all([runBackup("cron"), runBackup("manual")]);
    expect(runs.map((r) => r.outcome).sort()).toEqual(["created", "skipped"]);
    expect(gh.names()).toHaveLength(1);
    expect(await (await T.raw()).exists(T.key("backup:lock"))).toBe(0);
  });
  it("the lock expires on its own (a crashed run cannot block backups forever)", async () => {
    await withData();
    await runBackup("cron");
    const r = await T.raw();
    await r.set(T.key("backup:lock"), "x", { EX: 300 });
    const ttl = await r.ttl(T.key("backup:lock"));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });
});

describe("freshness", () => {
  const NOW = Date.parse("2027-06-01T12:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  it("unconfigured / never / ok / stale around the 36 hour boundary", () => {
    expect(freshness(null, false)).toEqual({ state: "unconfigured", lastSuccessAt: null, ageHours: null });
    expect(freshness("2027-06-01T00:00:00Z", false).state).toBe("unconfigured");
    expect(freshness(null, true)).toEqual({ state: "never", lastSuccessAt: null, ageHours: null });
    expect(freshness(new Date(NOW - 3600_000).toISOString(), true)).toMatchObject({ state: "ok", ageHours: 1 });
    expect(freshness(new Date(NOW - STALE_AFTER_MS).toISOString(), true)).toMatchObject({ state: "ok", ageHours: 36 });
    expect(freshness(new Date(NOW - STALE_AFTER_MS - 1).toISOString(), true)).toMatchObject({ state: "stale" });
    expect(freshness(new Date(NOW - 100 * 3600_000).toISOString(), true)).toMatchObject({ state: "stale", ageHours: 100 });
  });
  it("defaults to the live configuration", () => {
    expect(freshness(null).state).toBe("never");
    vi.stubEnv("BACKUP_GITHUB_TOKEN", "");
    expect(freshness(null).state).toBe("unconfigured");
  });
  it("readStatus survives garbage in Redis", async () => {
    await (await T.raw()).set(T.key("backup:status"), "{nope");
    expect(await readStatus()).toEqual({ lastSuccessAt: null, lastAttemptAt: null, history: [] });
  });
});

describe("remote listing and restore from GitHub", () => {
  it("lists only well-formed names, newest first", async () => {
    gh.seed("qr-20260101T000000Z-aaaaaaaa.qrbackup.json");
    gh.seed("qr-20260301T000000Z-bbbbbbbb.qrbackup.json");
    gh.seed("README.md");
    gh.seed("qr-bad-name.json");
    gh.seed("qr-20260201T123456Z-cccccccc.qrbackup.json");
    const list = await listSnapshots();
    expect(list.map((s) => s.name)).toEqual(["qr-20260301T000000Z-bbbbbbbb.qrbackup.json", "qr-20260201T123456Z-cccccccc.qrbackup.json", "qr-20260101T000000Z-aaaaaaaa.qrbackup.json"]);
    expect(list[1]).toMatchObject({ createdAt: "2026-02-01T12:34:56Z", hash8: "cccccccc", path: "snapshots/qr-20260201T123456Z-cccccccc.qrbackup.json" });
  });
  it("an empty/missing snapshots folder is an empty list, not an error", async () => {
    expect(await listSnapshots()).toEqual([]);
  });
  it("refuses path-traversal style names", async () => {
    for (const name of ["../secrets", "qr-x.qrbackup.json", "snapshots/qr-20260101T000000Z-aaaaaaaa.qrbackup.json"]) {
      await expect(fetchRemote(name)).rejects.toThrow("Invalid snapshot name");
    }
    expect(gh.fetch).not.toHaveBeenCalled();
  });
  it("round trip: back up, wipe Redis, restore from GitHub, library is back", async () => {
    const s = await withData();
    const before = Object.fromEntries((await listCodes()).records.map((r) => [r.id, r]));
    const run = await runBackup("manual");
    await T.reset();
    const { report, envelope } = await restoreFrom({ github: run.name! }, { dryRun: false, mode: "merge", prefer: "newer" });
    expect(report).toMatchObject({ applied: true, codes: { create: 6 } });
    expect(envelope).toMatchObject({ recordCount: 6, schemaVersion: 1 });
    expect(Object.fromEntries((await listCodes()).records.map((r) => [r.id, r]))).toEqual(before);
    expect(await getMeta()).not.toBeNull();
    expect(s.ids).toHaveLength(6);
    // a code created after the backup is untouched by a merge restore
    const later = await createCode(dynamicUrl({ slug: "after-backup" }));
    await restoreFrom({ github: run.name! }, { dryRun: false, mode: "merge", prefer: "newer" });
    expect((await listCodes()).records.map((r) => r.id)).toContain(later.id);
  });
  it("downloading a missing snapshot is a clear error", async () => {
    await expect(fetchRemote("qr-20260101T000000Z-aaaaaaaa.qrbackup.json")).rejects.toThrow(/Downloading snapshot failed \(404\)/);
  });
});

it("backs up orphaned primary records even when the secondary index is damaged", async () => {
  const seeded = await withData();
  await (await T.raw()).zRem(T.key("index:codes"), seeded.alpha.id);
  const run = await runBackup("manual");
  expect(run).toMatchObject({ outcome: "created", records: 6 });
});

it("checks remote integrity before calling a backup unchanged", async () => {
  await withData();
  const first = await runBackup("manual");
  gh.files.get(`snapshots/${first.name}`)!.content = "corrupted";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 5000);
  const second = await runBackup("manual");
  expect(second).toMatchObject({ outcome: "created", records: 6 });
  expect(second.name).not.toBe(first.name);
});

it("records an unfinished attempt before remote I/O so a killed upload remains observable", async () => {
  await withData();
  const original = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => { await gate; return original(input, init); });
  const pending = runBackup("manual");
  try {
    await expect.poll(async () => (await readStatus()).history[0]?.error).toMatch(/has not completed/);
    expect((await readStatus()).lastSuccessAt).toBeNull();
  } finally { release(); }
  expect((await pending).outcome).toBe("created");
  expect((await readStatus()).history).toHaveLength(1);
});
