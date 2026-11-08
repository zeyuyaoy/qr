import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto";
import { BackupFormatError, ENVELOPE_FORMAT, open, parseEnvelope, seal } from "@/lib/backup/envelope";
import { KEEP_MONTHS, KEEP_RECENT, MAX_PRUNE, planPrune, snapshotName, type RemoteSnapshot } from "@/lib/backup/github";
import { SNAPSHOT_FORMAT, contentHash, packSnapshot, unpackSnapshot, type Snapshot } from "@/lib/backup/snapshot";
import { SCHEMA_VERSION } from "@/lib/schema";

const key = () => randomBytes(32).toString("base64");
const meta = (plain: string) => ({ createdAt: "2027-06-01T12:00:00.000Z", schemaVersion: 1, recordCount: 2, contentSha256: sha256Hex(plain) });

describe("backup envelope", () => {
  it("round-trips and keeps the plaintext out of the file", () => {
    const k = key();
    const plain = JSON.stringify({ secret: "my-wifi-password", slug: "promo" });
    const e = seal(plain, meta(plain), k);
    expect(e).toMatchObject({ format: ENVELOPE_FORMAT, version: 1, alg: "A256GCM+gzip", recordCount: 2 });
    const text = JSON.stringify(e);
    expect(text).not.toContain("my-wifi-password");
    expect(open(parseEnvelope(text), k)).toBe(plain);
  });
  it("fails with the wrong key", () => {
    const plain = "{}";
    const e = seal(plain, meta(plain), key());
    expect(() => open(e, key())).toThrow(BackupFormatError);
    expect(() => open(e, key())).toThrow(/wrong BACKUP_ENCRYPTION_KEY/);
  });
  it("fails when a ciphertext byte is flipped", () => {
    const k = key();
    const plain = "x".repeat(500);
    const e = seal(plain, meta(plain), k);
    const buf = Buffer.from(e.data, "base64");
    for (const i of [0, 13, 28, buf.length - 1]) {
      const t = Buffer.from(buf);
      t[i] = t[i]! ^ 0x80;
      expect(() => open({ ...e, data: t.toString("base64") }, k), `byte ${i}`).toThrow(BackupFormatError);
    }
    expect(() => open({ ...e, data: buf.subarray(0, 40).toString("base64") }, k)).toThrow(BackupFormatError);
  });
  it("authenticates the header: counts, dates and versions cannot be edited", () => {
    const k = key();
    const plain = "{}";
    const e = seal(plain, meta(plain), k);
    expect(() => open({ ...e, recordCount: 3 }, k)).toThrow(/modified|corrupted/);
    expect(() => open({ ...e, createdAt: "2027-06-02T12:00:00.000Z" }, k)).toThrow(/modified|corrupted/);
    expect(() => open({ ...e, schemaVersion: 2 }, k)).toThrow(/modified|corrupted/);
    expect(() => open({ ...e, contentSha256: sha256Hex("other") }, k)).toThrow(/modified|corrupted/);
  });
  it("detects a checksum mismatch even when the header is authentic", () => {
    const k = key();
    const e = seal("{}", { ...meta("{}"), contentSha256: sha256Hex("something else") }, k);
    expect(() => open(e, k)).toThrow("Checksum mismatch: backup contents are corrupted");
  });
  it("rejects malformed JSON and things that are not backups", () => {
    expect(() => parseEnvelope("not json")).toThrow("Backup file is not valid JSON");
    expect(() => parseEnvelope("")).toThrow("Backup file is not valid JSON");
    const ok = seal("{}", meta("{}"), key());
    for (const bad of ["null", "[]", "{}", JSON.stringify({ ...ok, format: "other" }), JSON.stringify({ ...ok, version: 2 }), JSON.stringify({ ...ok, alg: "none" }), JSON.stringify({ ...ok, data: 5 })]) {
      expect(() => parseEnvelope(bad), bad.slice(0, 40)).toThrow(/Not a QR Studio backup/);
    }
    expect(parseEnvelope(JSON.stringify(ok))).toEqual(ok);
  });
  it("rejects invalid keys", () => {
    expect(() => seal("{}", meta("{}"), undefined)).toThrow("BACKUP_ENCRYPTION_KEY is not configured");
    expect(() => seal("{}", meta("{}"), randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => open(seal("{}", meta("{}"), key()), "short")).toThrow(/32 bytes/);
  });
});

const baseSnapshot = (o: Partial<Snapshot> = {}): Snapshot => ({
  format: SNAPSHOT_FORMAT,
  version: 1,
  schemaVersion: SCHEMA_VERSION,
  createdAt: "2027-06-01T12:00:00.000Z",
  meta: { schemaVersion: SCHEMA_VERSION, initializedAt: "2027-01-01T00:00:00.000Z", instanceId: "inst1" },
  codes: [],
  folders: [],
  templates: [],
  settings: null,
  assets: {},
  counts: {},
  stats: [],
  ...o,
});

describe("snapshot pack / unpack", () => {
  it("round-trips", () => {
    const k = key();
    const s = baseSnapshot({ codes: ['{"id":"a"}', '{"id":"b"}'], counts: { a: 3 }, stats: [{ key: "all:20270601", ttl: 100, fields: { n: "3" } }] });
    const { text, envelope } = packSnapshot(s, k);
    expect(envelope.recordCount).toBe(2);
    expect(unpackSnapshot(text, k).snapshot).toEqual(s);
  });
  it("contentHash ignores the timestamp but not the data", () => {
    const a = baseSnapshot();
    expect(contentHash(a)).toBe(contentHash({ ...a, createdAt: "2030-01-01T00:00:00.000Z" }));
    expect(contentHash(a)).not.toBe(contentHash({ ...a, counts: { x: 1 } }));
  });
  it("rejects wrong keys and tampering before returning anything", () => {
    const { text } = packSnapshot(baseSnapshot(), key());
    expect(() => unpackSnapshot(text, key())).toThrow(BackupFormatError);
    expect(() => unpackSnapshot(text.slice(0, text.length - 20), key())).toThrow(BackupFormatError);
    expect(() => unpackSnapshot("{}", key())).toThrow(BackupFormatError);
  });
  it("rejects snapshots written by a newer build", () => {
    const k = key();
    const { text } = packSnapshot(baseSnapshot({ schemaVersion: SCHEMA_VERSION + 1 }), k);
    expect(() => unpackSnapshot(text, k)).toThrow(/schema v2; this build supports up to v1/);
  });
  it("rejects structurally invalid snapshots and count mismatches", () => {
    const k = key();
    const bad = JSON.stringify({ ...baseSnapshot(), codes: "nope" });
    const e = seal(bad, { createdAt: "x", schemaVersion: 1, recordCount: 0, contentSha256: sha256Hex(bad) }, k);
    expect(() => unpackSnapshot(JSON.stringify(e), k)).toThrow(/Snapshot structure is invalid/);

    const s = baseSnapshot({ codes: ['{"id":"a"}'] });
    const plain = JSON.stringify(s);
    const lying = seal(plain, { createdAt: s.createdAt, schemaVersion: s.schemaVersion, recordCount: 7, contentSha256: sha256Hex(plain) }, k);
    expect(() => unpackSnapshot(JSON.stringify(lying), k)).toThrow("Record count does not match the header");

  });
});

describe("snapshotName", () => {
  it("encodes the timestamp and the first 8 hash characters", () => {
    expect(snapshotName("2026-11-08T12:00:00.123Z", "ab12cd34ef567890")).toBe("qr-20261108T120000Z-ab12cd34.qrbackup.json");
    expect(snapshotName("2026-01-02T03:04:05Z", "0".repeat(64))).toBe("qr-20260102T030405Z-00000000.qrbackup.json");
  });
  it("sorts chronologically as text", () => {
    const names = ["2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", "2026-12-31T23:59:59Z"].map((t) => snapshotName(t, "a".repeat(8)));
    expect([...names].sort()).toEqual(names);
  });
});

describe("planPrune (retention)", () => {
  const DAY = 86_400_000;
  const snap = (t: number): RemoteSnapshot => {
    const createdAt = new Date(t).toISOString().replace(/\.\d+Z$/, "Z");
    const name = snapshotName(createdAt, "a".repeat(8));
    return { name, path: `snapshots/${name}`, sha: `sha-${name}`, size: 1, createdAt, hash8: "aaaaaaaa" };
  };
  const END = Date.UTC(2026, 10, 8, 12);
  const daily = (n: number, step = 1) => Array.from({ length: n }, (_, i) => snap(END - i * step * DAY));

  it("uses the documented limits", () => {
    expect([KEEP_RECENT, KEEP_MONTHS, MAX_PRUNE]).toEqual([30, 12, 25]);
  });
  it("prunes nothing for empty, one or <= 30 snapshots", () => {
    expect(planPrune([])).toEqual([]);
    expect(planPrune(daily(1))).toEqual([]);
    expect(planPrune(daily(30))).toEqual([]);
  });
  it("keeps the 30 newest plus the newest of each month, pruning the rest oldest-first", () => {
    const all = daily(35); // 2026-11-08 back to 2026-10-05
    const pruned = planPrune(all);
    expect(pruned.map((s) => s.createdAt.slice(0, 10))).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });
  it("keeps the newest snapshot of an old month even when it is not among the 30 newest", () => {
    // 40 daily snapshots (Nov 8 .. Sep 30): the 30 newest end at Oct 10; Sep 30 is the only September one.
    const all = daily(40);
    const pruned = planPrune(all).map((s) => s.createdAt.slice(0, 10));
    expect(pruned).not.toContain("2026-09-30");
    expect(pruned).toContain("2026-10-09");
    expect(pruned).toContain("2026-10-01");
    expect(pruned).not.toContain("2026-11-08");
    expect(pruned).toHaveLength(9); // exactly Oct 1..Oct 9
  });
  it("never prunes the newest snapshot, whatever the input order", () => {
    const all = daily(200, 1);
    const newest = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
    const shuffled = [...all].sort(() => 0.5 - Math.random());
    expect(planPrune(shuffled).map((s) => s.name)).not.toContain(newest.name);
  });
  it("prunes at most 25 per run, oldest first", () => {
    const all = daily(200, 1);
    const pruned = planPrune(all);
    expect(pruned).toHaveLength(MAX_PRUNE);
    const stamps = pruned.map((s) => s.createdAt);
    expect(stamps).toEqual([...stamps].sort());
    // the oldest candidates go first
    const candidates = all.filter((s) => !planPrune(all).includes(s));
    expect(candidates.length).toBe(175);
    expect(pruned[0]!.createdAt <= stamps[stamps.length - 1]!).toBe(true);
  });
  it("keeps the newest snapshot of each of the last 12 months and drops older months", () => {
    // one snapshot every 10 days for ~2 years -> many more than 30
    const all = daily(75, 10);
    const keep = new Set(all.map((s) => s.name));
    // run to completion in rounds of 25 so the cap does not hide the final outcome
    let remaining = all;
    for (let i = 0; i < 10; i++) {
      const p = planPrune(remaining);
      if (!p.length) break;
      const drop = new Set(p.map((s) => s.name));
      remaining = remaining.filter((s) => !drop.has(s.name));
    }
    const kept = new Set(remaining.map((s) => s.name));
    const sorted = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const s of sorted.slice(0, 30)) expect(kept.has(s.name)).toBe(true);
    const newestPerMonth = new Map<string, RemoteSnapshot>();
    for (const s of sorted) if (!newestPerMonth.has(s.createdAt.slice(0, 7))) newestPerMonth.set(s.createdAt.slice(0, 7), s);
    [...newestPerMonth.values()].slice(0, 12).forEach((s) => expect(kept.has(s.name), s.createdAt).toBe(true));
    // anything beyond those is gone
    const expectedKept = new Set([...sorted.slice(0, 30), ...[...newestPerMonth.values()].slice(0, 12)].map((s) => s.name));
    expect(kept).toEqual(expectedKept);
    expect(kept.size).toBeLessThan(keep.size);
  });
});

describe("contentHash and stats TTLs", () => {
  it("ignores the countdown TTL of stats keys so unchanged data hashes the same", () => {
    const a = baseSnapshot({ stats: [{ key: "all:20270601", ttl: 7_000_000, fields: { n: "3" } }] });
    const b = baseSnapshot({ stats: [{ key: "all:20270601", ttl: 6_999_990, fields: { n: "3" } }] });
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash(baseSnapshot({ stats: [{ key: "all:20270601", ttl: 7_000_000, fields: { n: "4" } }] })));
  });
});
