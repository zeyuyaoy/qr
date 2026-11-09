import {randomBytes} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    createInput,
    defaultSettings,
    defaultStyle,
    folderSchema,
    type QrRecord,
    qrRecordSchema,
    scheduleSchema,
    SCHEMA_VERSION,
    settingsSchema,
    slugSchema,
    tagSchema,
    templateSchema,
    updateInput
} from "@/lib/schema";
import {migrateRecord} from "@/lib/redis/migrate";
import {needsSealing, open, seal, SealError} from "@/lib/seal";
import {storedSchema, toView} from "@/lib/redis/repo";

const NOW = "2027-06-01T12:00:00.000Z";
const record = (o: Partial<QrRecord> = {}): QrRecord =>
    qrRecordSchema.parse({
        v: SCHEMA_VERSION,
        id: "abcdefgh12345",
        name: "My code",
        type: "url",
        mode: "dynamic",
        payload: "https://example.com/a?b=1#c",
        slug: "my-slug",
        style: defaultStyle(),
        rev: 1,
        createdAt: NOW,
        updatedAt: NOW,
        ...o,
    });

describe("qrRecordSchema", () => {
    it("fills defaults", () => {
        const r = record();
        expect(r).toMatchObject({
            description: "",
            fields: {},
            tags: [],
            folder: null,
            favorite: false,
            pinned: false,
            status: "active",
            enabled: true,
            scanLimit: null,
            password: null,
            analytics: true,
            afterExpiry: {message: null, redirectUrl: null},
            schedule: {activateAt: null, expiresAt: null, expireAfterSeconds: null},
        });
    });
    it("round-trips through JSON unchanged", () => {
        const r = record({tags: ["a", "b"], scanLimit: 5, password: {hash: "scrypt$x", setAt: NOW}});
        expect(qrRecordSchema.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
    });
    it.each([
        ["v", 2],
        ["id", "SHORT"],
        ["id", "has spaces here"],
        ["name", "   "],
        ["name", "x".repeat(121)],
        ["type", "fax"],
        ["mode", "hybrid"],
        ["payload", ""],
        ["payload", "x".repeat(4001)],
        ["slug", "ab"],
        ["slug", "-bad"],
        ["slug", "UPPER"],
        ["rev", 0],
        ["createdAt", "yesterday"],
        ["scanLimit", 0],
        ["scanLimit", 10_000_001],
        ["status", "deleted"],
    ])("rejects %s = %j", (k, v) => {
        expect(qrRecordSchema.safeParse({...record(), [k]: v}).success).toBe(false);
    });
    it("trims the name and accepts offset timestamps", () => {
        expect(record({name: "  padded  "}).name).toBe("padded");
        expect(qrRecordSchema.safeParse({...record(), createdAt: "2027-06-01T12:00:00+02:00"}).success).toBe(true);
    });
});

describe("small schemas", () => {
    it("tagSchema normalises", () => {
        expect(tagSchema.parse("  Menu 2027 ")).toBe("menu 2027");
        expect(tagSchema.safeParse("").success).toBe(false);
        expect(tagSchema.safeParse("x".repeat(33)).success).toBe(false);
        expect(tagSchema.safeParse("-lead").success).toBe(false);
        expect(tagSchema.safeParse("a/b").success).toBe(false);
    });
    it("slugSchema bounds", () => {
        expect(slugSchema.safeParse("abc").success).toBe(true);
        expect(slugSchema.safeParse("a_b-c").success).toBe(true);
        expect(slugSchema.safeParse("a".repeat(64)).success).toBe(true);
        expect(slugSchema.safeParse("a".repeat(65)).success).toBe(false);
        expect(slugSchema.safeParse("a b").success).toBe(false);
    });
    it("scheduleSchema enforces a 60 s minimum relative expiry", () => {
        expect(scheduleSchema.safeParse({expireAfterSeconds: 59}).success).toBe(false);
        expect(scheduleSchema.safeParse({expireAfterSeconds: 60}).success).toBe(true);
        expect(scheduleSchema.parse({})).toEqual({activateAt: null, expiresAt: null, expireAfterSeconds: null});
    });
    it("settings default and validate", () => {
        const s = defaultSettings();
        expect(s).toMatchObject({
            v: 1,
            format: "png",
            size: 1024,
            mode: "static",
            theme: "system",
            timezone: "UTC",
            filenameTemplate: "{name}"
        });
        expect(s.analytics).toEqual({enabled: true, devices: true, geo: false, retentionDays: 90});
        expect(s.brand.name).toBe("QR Studio");
        expect(settingsSchema.safeParse({analytics: {retentionDays: 6}}).success).toBe(false);
        expect(settingsSchema.safeParse({analytics: {retentionDays: 366}}).success).toBe(false);
        expect(settingsSchema.safeParse({brand: {accent: "red"}}).success).toBe(false);
        expect(settingsSchema.safeParse({format: "gif"}).success).toBe(false);
    });
    it("folders and templates validate", () => {
        const base = {id: "abcdefgh1", createdAt: NOW, updatedAt: NOW};
        expect(folderSchema.parse({...base, name: " F "})).toMatchObject({name: "F", color: null});
        expect(folderSchema.safeParse({...base, name: "F", color: "blue"}).success).toBe(false);
        expect(templateSchema.safeParse({...base, name: "T", style: defaultStyle()}).success).toBe(true);
        expect(templateSchema.safeParse({...base, name: "", style: defaultStyle()}).success).toBe(false);
    });
});

describe("mutation inputs", () => {
    const base = {name: "n", type: "url", mode: "static", payload: "https://example.com", style: defaultStyle()};
    it("createInput needs only the essentials and accepts a plain password", () => {
        expect(createInput.safeParse(base).success).toBe(true);
        expect(createInput.safeParse({...base, password: "abcd", opId: "op1", id: "abcdefgh1"}).success).toBe(true);
        expect(createInput.safeParse({...base, password: "abc"}).success).toBe(false);
        expect(createInput.safeParse({...base, password: null}).success).toBe(true);
        expect(createInput.safeParse({...base, opId: "x".repeat(41)}).success).toBe(false);
    });
    it("createInput strips server-owned fields", () => {
        const p = createInput.parse({...base, rev: 99, createdAt: NOW, v: 1}) as Record<string, unknown>;
        expect(p).not.toHaveProperty("rev");
        expect(p).not.toHaveProperty("createdAt");
    });
    it("updateInput requires ifRev and treats password tri-state", () => {
        expect(updateInput.safeParse({name: "x"}).success).toBe(false);
        expect(updateInput.safeParse({ifRev: 0}).success).toBe(false);
        expect(updateInput.parse({ifRev: 2})).toEqual({ifRev: 2});
        expect(updateInput.parse({ifRev: 2, name: "x", pinned: true})).toEqual({ifRev: 2, name: "x", pinned: true});
        expect(updateInput.parse({ifRev: 2, password: null})).toMatchObject({password: null});
        expect(updateInput.parse({ifRev: 2, password: "abcd"})).toMatchObject({password: "abcd"});
        expect(updateInput.safeParse({ifRev: 1, id: "zzzzzzzz"}).success).toBe(true);
        expect(updateInput.parse({ifRev: 1, id: "zzzzzzzz", createdAt: NOW})).toEqual({ifRev: 1});
    });
});

describe("toView", () => {
    it("never exposes the password hash and adds live fields", () => {
        const v = toView(record({password: {hash: "scrypt$secret", setAt: NOW}, scanLimit: 3}), 3, Date.parse(NOW));
        expect(v).not.toHaveProperty("password");
        expect(JSON.stringify(v)).not.toContain("scrypt$secret");
        expect(v).toMatchObject({hasPassword: true, scans: 3, linkState: "exhausted"});
        expect(toView(record(), 0, Date.parse(NOW))).toMatchObject({hasPassword: false, linkState: "ok"});
    });
});

describe("migrateRecord", () => {
    it("passes current-version records through untouched", () => {
        const r = JSON.parse(JSON.stringify(record()));
        expect(migrateRecord(r)).toEqual(r);
    });
    it("rejects records from a newer build instead of guessing", () => {
        expect(() => migrateRecord({v: SCHEMA_VERSION + 1})).toThrow(/newer than this build/);
        expect(() => migrateRecord({v: 99})).toThrow(/v99/);
    });
    it("rejects non-objects and unknown old versions", () => {
        for (const bad of [null, undefined, "x", 3, true]) expect(() => migrateRecord(bad)).toThrow("Record is not an object");
        expect(() => migrateRecord({v: 0})).toThrow("No migration from schema v0");
    });
    it("treats a missing version as v1", () => {
        const {v: _v, ...rest} = JSON.parse(JSON.stringify(record()));
        void _v;
        expect(migrateRecord(rest)).toEqual(rest);
    });
    it("the stored schema (record + sealed) rejects newer versions too", () => {
        expect(storedSchema.safeParse({...record(), v: 2}).success).toBe(false);
    });
});

describe("seal / open", () => {
    const KEY = randomBytes(32).toString("base64");
    beforeEach(() => vi.stubEnv("DATA_ENCRYPTION_KEY", KEY));
    afterEach(() => vi.unstubAllEnvs());

    const wifi = (o: Partial<QrRecord> = {}) =>
        record({
            type: "wifi",
            mode: "static",
            slug: null,
            payload: "WIFI:T:WPA;S:Home;P:hunter2hunter2;;",
            fields: {ssid: "Home", password: "hunter2hunter2", security: "WPA", hidden: false},
            ...o,
        });

    it("only wifi and vcard need sealing", () => {
        expect(needsSealing("wifi")).toBe(true);
        expect(needsSealing("vcard")).toBe(true);
        for (const t of ["url", "text", "email", "phone", "sms", "event", "geo", "whatsapp", "social", "doi"] as const) expect(needsSealing(t)).toBe(false);
    });
    it("leaves non-sensitive records untouched (same object)", () => {
        const r = record();
        expect(seal(r)).toBe(r);
    });
    it("removes secrets from the stored form and restores them exactly", () => {
        const r = wifi();
        const s = seal(r);
        const json = JSON.stringify(s);
        expect(s.payload).toBe("sealed");
        expect(s.fields).toEqual({});
        expect(typeof s.sealed).toBe("string");
        expect(json).not.toContain("hunter2");
        expect(json).not.toContain("WIFI:");
        expect(s.name).toBe(r.name);
        const back = open(JSON.parse(json));
        expect(back).toEqual(r);
        expect(back).not.toHaveProperty("sealed");
    });
    it("produces a different blob each time (random IV)", () => {
        expect(seal(wifi()).sealed).not.toBe(seal(wifi()).sealed);
    });
    it("passes records without a sealed blob through open()", () => {
        const r = record();
        expect(open(r)).toBe(r);
    });
    it("binds the blob to the record id (AAD): moving it to another id fails", () => {
        const s = seal(wifi());
        expect(() => open({...s, id: "zzzzzzzzzzzzz"})).toThrow(SealError);
    });
    it("detects tampering with the sealed blob", () => {
        const s = seal(wifi());
        const buf = Buffer.from(s.sealed!, "base64");
        buf[buf.length - 1] = buf[buf.length - 1]! ^ 1;
        expect(() => open({...s, sealed: buf.toString("base64")})).toThrow(SealError);
        expect(() => open({...s, sealed: "AAAA"})).toThrow(SealError);
    });
    it("fails with a different key", () => {
        const s = seal(wifi());
        vi.stubEnv("DATA_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
        expect(() => open(s)).toThrow(SealError);
    });
    it("sealing without DATA_ENCRYPTION_KEY is a SealError", () => {
        vi.stubEnv("DATA_ENCRYPTION_KEY", "");
        expect(() => seal(wifi())).toThrow(SealError);
        expect(() => seal(wifi())).toThrow(/DATA_ENCRYPTION_KEY/);
    });
    it("opening without DATA_ENCRYPTION_KEY is also a SealError (maps to NOT_CONFIGURED, not a 500)", () => {
        const s = seal(wifi());
        vi.stubEnv("DATA_ENCRYPTION_KEY", "");
        expect(() => open(s)).toThrow(SealError);
    });
    it("a malformed key is a SealError when opening", () => {
        const s = seal(wifi());
        vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.from("short").toString("base64"));
        expect(() => open(s)).toThrow(SealError);
    });
});
