import {T} from "./helpers/boot";
import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";
import {normalize, SECRET_DEST, type Seeded, seedLibrary} from "./helpers/seed";
import {dynamicUrl, WIFI_PASSWORD} from "./helpers/fixtures";
import {BackupFormatError, parseEnvelope} from "@/lib/backup/envelope";
import {restoreFrom} from "@/lib/backup/run";
import {
    collectSnapshot,
    packSnapshot,
    type RestoreOptions,
    restoreSnapshot,
    type Snapshot,
    SNAPSHOT_FORMAT,
    unpackSnapshot
} from "@/lib/backup/snapshot";
import {closeRedis} from "@/lib/redis/client";
import {repairIndexes, upsertTemplate} from "@/lib/redis/maintenance";
import {
    createCode,
    getAsset,
    getCode,
    getMeta,
    getSettings,
    initMeta,
    listCodes,
    listFolders,
    listTags,
    listTemplates,
    readStats,
    resolveSlug,
    saveFolder,
    saveTemplate,
    scanCount
} from "@/lib/redis/repo";
import {dayKey} from "@/lib/redis/keys";
import {verifyPassword} from "@/lib/crypto";
import {defaultStyle} from "@/lib/schema";

vi.mock("@/lib/redis/maintenance", async (importOriginal) => {
    const m = await importOriginal<typeof import("@/lib/redis/maintenance")>();
    return {...m, upsertTemplate: vi.fn(m.upsertTemplate)};
});

let seeded: Seeded;
beforeEach(async () => {
    vi.unstubAllEnvs();
    await T.reset();
    await initMeta();
    seeded = await seedLibrary();
});
afterAll(async () => {
    await T.cleanup();
    await closeRedis();
    await T.close();
});

const OPTS: RestoreOptions = {dryRun: false, mode: "merge", prefer: "newer"};
const snap = async () => (await collectSnapshot()).snapshot;
const editCode = (s: Snapshot, id: string, fn: (rec: Record<string, unknown>) => Record<string, unknown>): Snapshot => ({
    ...s,
    codes: s.codes.map((raw) => (JSON.parse(raw).id === id ? JSON.stringify(fn(JSON.parse(raw))) : raw)),
});
const records = async () => Object.fromEntries((await listCodes()).records.map((r) => [r.id, r]));
const cleanRepair = async () => {
    const r = await repairIndexes(false);
    expect(r).toMatchObject({
        corrupt: [],
        missingFromIndex: [],
        staleIndexEntries: [],
        slugFixed: 0,
        slugConflicts: [],
        folderFixed: 0,
        tagFixed: 0,
        orphanAssets: 0
    });
    return r;
};
const FOREIGN = () => [`research:qrtest-${T.prefix.split(":")[2]}:foo`, `link:qrtest-${T.prefix.split(":")[2]}:x`];

describe("collectSnapshot", () => {
    it("captures every primary record without decrypting", async () => {
        const {snapshot, skipped} = await collectSnapshot();
        expect(skipped).toEqual([]);
        expect(snapshot).toMatchObject({format: SNAPSHOT_FORMAT, version: 1, schemaVersion: 1});
        expect(snapshot.codes).toHaveLength(6);
        expect(snapshot.folders.map((f) => f.name).sort()).toEqual(["Personal", "Work stuff"]);
        expect(snapshot.templates).toHaveLength(1);
        expect(snapshot.settings).toMatchObject({brand: {name: "Acme Corp"}});
        expect(Object.keys(snapshot.assets)).toEqual([seeded.assetId]);
        expect(snapshot.counts).toEqual({[seeded.alpha.id]: 3, [seeded.beta.id]: 1});
        expect(snapshot.meta).toEqual(await getMeta());
        expect(snapshot.stats.map((s) => s.key).sort()).toEqual([`all:${dayKey(Date.now())}`, `${seeded.alpha.id}:${dayKey(Date.now())}`, `${seeded.beta.id}:${dayKey(Date.now())}`].sort());
        expect(snapshot.stats.every((s) => s.ttl > 0)).toBe(true);
        expect(JSON.stringify(snapshot)).not.toContain(WIFI_PASSWORD);
    });
    it("reports unreadable records instead of failing, and leaves them out", async () => {
        await (await T.raw()).set(T.key(`code:${seeded.eps.id}`), "{broken");
        const {snapshot, skipped} = await collectSnapshot();
        expect(skipped).toEqual([seeded.eps.id]);
        expect(snapshot.codes).toHaveLength(5);
    });
    it("is deterministic for unchanged data (same content hash apart from the timestamp)", async () => {
        const {contentHash} = await import("@/lib/backup/snapshot");
        const a = await snap();
        const b = await snap();
        expect(contentHash(a)).toBe(contentHash(b));
        await (await T.raw()).expire(T.key(`stats:all:${dayKey(Date.now())}`), 12345);
        expect(contentHash(await snap())).toBe(contentHash(a));
    });
});

describe("pack / unpack", () => {
    it("round-trips, and the encrypted file contains no plaintext data", async () => {
        const s = await snap();
        const {text, envelope} = packSnapshot(s, T.backupKey);
        expect(envelope.recordCount).toBe(6);
        for (const secret of ["bk-alpha", "bk-beta", "secret-destination.example", "abc123", "Alpha Menu", "Guest wifi", "Work stuff", "Acme Corp", WIFI_PASSWORD, "Lovelace", s.meta!.instanceId, seeded.alpha.id, "pw-secret1", "scrypt$"]) {
            expect(text, secret).not.toContain(secret);
        }
        expect(unpackSnapshot(text, T.backupKey).snapshot).toEqual(s);
        expect(parseEnvelope(text)).toMatchObject({format: "qr-studio-backup", recordCount: 6});
    });
});

describe("restore: dry run", () => {
    it("changes nothing in a populated library (full dump identical)", async () => {
        const s = await snap();
        const before = await T.dump();
        for (const mode of ["merge", "replace"] as const) {
            for (const prefer of ["newer", "snapshot", "existing"] as const) {
                const rep = await restoreSnapshot(s, {dryRun: true, mode, prefer});
                expect(rep).toMatchObject({dryRun: true, applied: false, mode, prefer});
                expect(await T.dump()).toEqual(before);
            }
        }
    });
    it("into an empty library reports what would happen and writes nothing", async () => {
        const s = await snap();
        await T.reset();
        const rep = await restoreSnapshot(s, {dryRun: true, mode: "merge", prefer: "newer"});
        expect(rep).toMatchObject({
            applied: false,
            metaWillBeCreated: true,
            folders: 2,
            templates: 1,
            assets: 1,
            statsKeys: 3,
            codes: {create: 6, update: 0, unchanged: 0, invalid: 0, delete: 0, slugConflicts: 0}
        });
        expect(await T.keys()).toEqual([]);
    });
    it("reports unchanged records when restoring a snapshot onto its own source", async () => {
        const rep = await restoreSnapshot(await snap(), {dryRun: true, mode: "merge", prefer: "newer"});
        expect(rep.codes).toMatchObject({create: 0, update: 0, unchanged: 6, keptExisting: 0});
        expect(rep.metaWillBeCreated).toBe(false);
    });
});

describe("restore into an empty library", () => {
    it("recreates codes, folders, templates, settings, assets, counters, statistics and the meta sentinel", async () => {
        const s = await snap();
        const before = normalize(await T.dump());
        delete before.recent;
        const originalRecords = await records();
        await T.reset();
        expect(await getMeta()).toBeNull();

        const rep = await restoreSnapshot(unpackSnapshot(packSnapshot(s, T.backupKey).text, T.backupKey).snapshot, OPTS);
        expect(rep).toMatchObject({applied: true, codes: {create: 6, invalid: 0, slugConflicts: 0}});

        expect(await records()).toEqual(originalRecords);
        expect((await listFolders()).map((f) => f.name)).toEqual(["Personal", "Work stuff"]);
        expect(await listTemplates()).toEqual([seeded.template]);
        expect(await getSettings()).toEqual(seeded.settings);
        expect(await getAsset(seeded.assetId)).toMatch(/^data:image\/png;base64,/);
        expect(await scanCount(seeded.alpha.id)).toBe(3);
        expect(await scanCount(seeded.beta.id)).toBe(1);
        const [today] = await readStats([dayKey(Date.now())]);
        expect(today).toMatchObject({
            total: 4,
            devices: {mobile: 3, desktop: 1},
            codes: {[seeded.alpha.id]: 3, [seeded.beta.id]: 1}
        });
        expect(await getMeta()).toEqual(s.meta);
        expect(await listTags()).toEqual([{tag: "t1", count: 1}, {tag: "t2", count: 2}, {tag: "t3", count: 1}]);

        await cleanRepair();
        expect((await resolveSlug("bk-alpha"))!.record.id).toBe(seeded.alpha.id);
        expect(await verifyPassword("pw-secret1", (await getCode(seeded.alpha.id))!.password!.hash)).toBe(true);
        expect(normalize(await T.dump())).toEqual(before);
    });
    it("is idempotent: applying the same snapshot twice changes nothing the second time", async () => {
        const s = await snap();
        await T.reset();
        await restoreSnapshot(s, OPTS);
        const once = await T.dump();
        const rep = await restoreSnapshot(s, OPTS);
        expect(rep.codes).toMatchObject({create: 0, update: 0, unchanged: 6});
        expect(await T.dump()).toEqual(once);
    });
    it("creates the meta sentinel LAST: an interrupted restore leaves the library 'uninitialised' and re-runnable", async () => {
        const s = await snap();
        await T.reset();
        vi.mocked(upsertTemplate).mockRejectedValueOnce(new Error("connection dropped"));
        await expect(restoreSnapshot(s, OPTS)).rejects.toThrow("connection dropped");
        expect(await getMeta()).toBeNull();
        const rep = await restoreSnapshot(s, OPTS);
        expect(rep.applied).toBe(true);
        expect(await getMeta()).toEqual(s.meta);
        expect(Object.keys(await records())).toHaveLength(6);
        await cleanRepair();
    });
    it("initialises a fresh meta when the snapshot carries none", async () => {
        const s = {...(await snap()), meta: null};
        await T.reset();
        await restoreSnapshot(s, OPTS);
        expect(await getMeta()).toMatchObject({schemaVersion: 1});
    });
});

describe("restore: merge conflict policies", () => {
    const withOlder = async () => editCode(await snap(), seeded.alpha.id, (r) => ({
        ...r,
        name: "Snapshot name",
        updatedAt: "2020-01-01T00:00:00.000Z",
        rev: 1
    }));
    const withNewer = async () => editCode(await snap(), seeded.alpha.id, (r) => ({
        ...r,
        name: "Snapshot name",
        updatedAt: "2099-01-01T00:00:00.000Z",
        rev: 7
    }));
    const name = async () => (await getCode(seeded.alpha.id))!.name;

    it("newer: keeps a newer existing record", async () => {
        const rep = await restoreSnapshot(await withOlder(), {dryRun: false, mode: "merge", prefer: "newer"});
        expect(rep.codes).toMatchObject({keptExisting: 1, update: 0, unchanged: 5});
        expect(rep.conflicts).toEqual([{
            id: seeded.alpha.id,
            name: "Snapshot name",
            reason: "existing copy is newer; kept"
        }]);
        expect(await name()).toBe("Alpha Menu");
    });
    it("newer: takes a newer snapshot record and bumps rev past both", async () => {
        const rep = await restoreSnapshot(await withNewer(), {dryRun: false, mode: "merge", prefer: "newer"});
        expect(rep.codes).toMatchObject({update: 1, keptExisting: 0});
        expect(await name()).toBe("Snapshot name");
        expect((await getCode(seeded.alpha.id))!.rev).toBe(8);
        await cleanRepair();
    });
    it("snapshot: always wins, and says it overwrote a newer copy", async () => {
        const rep = await restoreSnapshot(await withOlder(), {dryRun: false, mode: "merge", prefer: "snapshot"});
        expect(rep.codes.update).toBe(1);
        expect(rep.conflicts[0]!.reason).toMatch(/overwritten by snapshot/);
        expect(await name()).toBe("Snapshot name");
    });
    it("existing: never overwrites", async () => {
        const rep = await restoreSnapshot(await withNewer(), {dryRun: false, mode: "merge", prefer: "existing"});
        expect(rep.codes).toMatchObject({keptExisting: 1, update: 0});
        expect(await name()).toBe("Alpha Menu");
    });
    it("merge never deletes anything that is not in the snapshot", async () => {
        const s = await snap();
        const extra = await createCode(dynamicUrl({slug: "extra-code"}));
        const f = await saveFolder({name: "Extra folder"});
        const rep = await restoreSnapshot(s, {dryRun: false, mode: "merge", prefer: "snapshot"});
        expect(rep.codes.delete).toBe(0);
        expect(await getCode(extra.id)).not.toBeNull();
        expect((await listFolders()).map((x) => x.id)).toContain(f.id);
    });
    it("keeps current settings unless the snapshot is preferred or replaces", async () => {
        const s = await snap();
        const {saveSettings} = await import("@/lib/redis/repo");
        await saveSettings({brand: {name: "Changed since"}});
        await restoreSnapshot(s, {dryRun: false, mode: "merge", prefer: "newer"});
        expect((await getSettings()).brand.name).toBe("Changed since");
        await restoreSnapshot(s, {dryRun: false, mode: "merge", prefer: "snapshot"});
        expect((await getSettings()).brand.name).toBe("Acme Corp");
    });
});

describe("restore: slug conflicts", () => {
    it("reports a snapshot code whose slug now belongs to another code, and does not write it", async () => {
        const s = await snap();
        const clone = JSON.parse(s.codes.find((raw) => JSON.parse(raw).id === seeded.alpha.id)!);
        const intruder = {...clone, id: "intruderid0001", name: "Intruder", slug: "bk-alpha"};
        const withIntruder: Snapshot = {...s, codes: [...s.codes, JSON.stringify(intruder)]};
        for (const dryRun of [true, false]) {
            const rep = await restoreSnapshot(withIntruder, {dryRun, mode: "merge", prefer: "newer"});
            expect(rep.codes.slugConflicts, `dryRun=${dryRun}`).toBe(1);
            expect(rep.conflicts).toContainEqual({
                id: "intruderid0001",
                name: "Intruder",
                reason: 'slug "bk-alpha" is used by another code'
            });
        }
        expect(await getCode("intruderid0001")).toBeNull();
        expect((await resolveSlug("bk-alpha"))!.record.id).toBe(seeded.alpha.id);
    });
    it("invalid records in a snapshot are counted and skipped, valid ones still restore", async () => {
        const s = await snap();
        const bad: Snapshot = {
            ...s,
            codes: [...s.codes, "{not json", JSON.stringify({...JSON.parse(s.codes[0]!), id: "futureid00001", v: 2})]
        };
        await T.reset();
        const rep = await restoreSnapshot(bad, OPTS);
        expect(rep.codes).toMatchObject({invalid: 2, create: 6});
        expect(Object.keys(await records())).toHaveLength(6);
    });
});

describe("restore: replace mode", () => {
    it("refuses invalid records before deleting or writing anything", async () => {
        const s = await snap();
        const before = await T.dump();
        const bad = {...s, codes: ["{broken"]};
        await expect(restoreSnapshot(bad, {...OPTS, mode: "replace"})).rejects.toThrow(/Replace refused/);
        expect(await T.dump()).toEqual(before);
    });
    it("validates settings and counters before any writes", async () => {
        const s = await snap();
        const before = await T.dump();
        for (const patch of [{settings: {invalid: true}}, {counts: {[seeded.alpha.id]: -1}}]) {
            await expect(restoreSnapshot({...s, ...patch}, OPTS)).rejects.toThrow(/invalid/);
            expect(await T.dump()).toEqual(before);
        }
    });
    it("never lowers authoritative scan limits when recovering an older counter", async () => {
        const s = await snap();
        s.counts[seeded.alpha.id] = 10;
        await restoreSnapshot(s, OPTS);
        expect(await scanCount(seeded.alpha.id)).toBe(10);
        s.counts[seeded.alpha.id] = 2;
        await restoreSnapshot(s, OPTS);
        expect(await scanCount(seeded.alpha.id)).toBe(10);
    });
    it("prunes codes, folders and templates that are not in the snapshot, but never touches foreign keys", async () => {
        const s = await snap();
        const extra = await createCode(dynamicUrl({slug: "to-prune", tags: ["prune-tag"]}));
        const extraFolder = await saveFolder({name: "Prune me"});
        const extraTemplate = await saveTemplate({name: "Prune template", style: defaultStyle()});
        const r = await T.raw();
        const [fa, fb] = FOREIGN();
        await r.set(fa!, "research-data");
        await r.set(fb!, "link-data");
        try {
            const dry = await restoreSnapshot(s, {dryRun: true, mode: "replace", prefer: "newer"});
            expect(dry.codes.delete).toBe(1);
            expect(await getCode(extra.id)).not.toBeNull();

            const rep = await restoreSnapshot(s, {dryRun: false, mode: "replace", prefer: "newer"});
            expect(rep).toMatchObject({applied: true, codes: {delete: 1}});
            expect(await getCode(extra.id)).toBeNull();
            expect(await r.exists(T.key("slug:to-prune"))).toBe(0);
            expect((await listFolders()).map((f) => f.id)).not.toContain(extraFolder.id);
            expect((await listTemplates()).map((t) => t.id)).not.toContain(extraTemplate.id);
            expect((await listTags()).map((t) => t.tag)).not.toContain("prune-tag");
            expect(Object.keys(await records()).sort()).toEqual(seeded.ids);
            await cleanRepair();
            expect([await r.get(fa!), await r.get(fb!)]).toEqual(["research-data", "link-data"]);
        } finally {
            await r.del([fa!, fb!]);
        }
    });
});

describe("namespace isolation", () => {
    it("foreign keys survive collect, restore, repair and analytics reset", async () => {
        const {resetAnalytics} = await import("@/lib/redis/repo");
        const r = await T.raw();
        const [fa, fb] = FOREIGN();
        const ff = `qr:v1:stats:qrtest${T.prefix.split(":")[2]}:20270101`;
        await r.set(fa!, "research-data");
        await r.set(fb!, "link-data");
        await r.hSet(ff, {n: "5"});
        try {
            const s = await snap();
            expect(JSON.stringify(s)).not.toContain("research-data");
            expect(s.stats.every((x) => !x.key.includes("qrtest"))).toBe(true);
            await restoreSnapshot(s, {dryRun: false, mode: "replace", prefer: "snapshot"});
            await repairIndexes(true);
            await resetAnalytics();
            await resetAnalytics(seeded.alpha.id);
            expect(await r.get(fa!)).toBe("research-data");
            expect(await r.get(fb!)).toBe("link-data");
            expect(await r.hGetAll(ff)).toEqual({n: "5"});
        } finally {
            await r.del([fa!, fb!, ff]);
        }
    });
});

describe("rejected snapshots never write", () => {
    const good = async () => {
        const s = await snap();
        const {text} = packSnapshot(s, T.backupKey);
        await T.reset();
        return {s, text};
    };
    const expectRejected = async (text: string) => {
        await expect(restoreFrom({text}, {
            dryRun: false,
            mode: "replace",
            prefer: "snapshot"
        })).rejects.toBeInstanceOf(BackupFormatError);
        expect(await T.keys(), "nothing may be written").toEqual([]);
    };
    const flip = (text: string, mutate: (e: Record<string, unknown>) => void) => {
        const e = JSON.parse(text);
        mutate(e);
        return JSON.stringify(e);
    };

    it("a good file does restore (control)", async () => {
        const {text} = await good();
        const {report} = await restoreFrom({text}, OPTS);
        expect(report.applied).toBe(true);
    });
    it("truncated file", async () => {
        const {text} = await good();
        await expectRejected(text.slice(0, Math.floor(text.length / 2)));
    });
    it("flipped ciphertext byte", async () => {
        const {text} = await good();
        await expectRejected(flip(text, (e) => {
            const buf = Buffer.from(e.data as string, "base64");
            buf[Math.floor(buf.length / 2)] = buf[Math.floor(buf.length / 2)]! ^ 1;
            e.data = buf.toString("base64");
        }));
    });
    it("modified header (record count, date, version)", async () => {
        const {text} = await good();
        await expectRejected(flip(text, (e) => void (e.recordCount = 5)));
        await expectRejected(flip(text, (e) => void (e.createdAt = "2020-01-01T00:00:00.000Z")));
        await expectRejected(flip(text, (e) => void (e.schemaVersion = 9)));
    });
    it("wrong decryption key", async () => {
        const {text} = await good();
        vi.stubEnv("BACKUP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
        await expectRejected(text);
    });
    it("not a backup at all", async () => {
        await T.reset();
        for (const text of ["", "garbage", "{}", "[]", JSON.stringify({format: "other"})]) await expectRejected(text);
    });
    it("snapshot written by a newer schema version", async () => {
        const s = {...(await snap()), schemaVersion: 2};
        await T.reset();
        await expectRejected(packSnapshot(s, T.backupKey).text);
    });
    it("structurally invalid snapshot, bad asset or stats keys", async () => {
        const s = await snap();
        await T.reset();
        await expectRejected(packSnapshot({...s, assets: {"not-hex": "data:image/png;base64,AA"}}, T.backupKey).text);
        await expectRejected(packSnapshot({...s, assets: {[seeded.assetId]: "javascript:alert(1)"}}, T.backupKey).text);
        await expectRejected(packSnapshot({
            ...s,
            stats: [{key: "../../evil:20270101", ttl: 10, fields: {n: "1"}}]
        }, T.backupKey).text);
        await expectRejected(packSnapshot({...s, codes: "nope" as never}, T.backupKey).text);
    });
    it("a missing key is a configuration error, not a crash", async () => {
        const {text} = await good();
        vi.stubEnv("BACKUP_ENCRYPTION_KEY", "");
        await expect(restoreFrom({text}, OPTS)).rejects.toThrow(/BACKUP_ENCRYPTION_KEY/);
        expect(await T.keys()).toEqual([]);
    });
});

describe("secrets in backups", () => {
    it("never include the destination in the clear, only inside the encrypted blob", async () => {
        const {text} = packSnapshot(await snap(), T.backupKey);
        expect(text).not.toContain(SECRET_DEST);
        expect(text).not.toContain("secret-destination");
    });
});
