import {T} from "./helpers/boot";
import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";
import {
    DEST,
    dynamicUrl,
    jpegDataUrl,
    pngDataUrl,
    staticText,
    vcard,
    webpDataUrl,
    wifi,
    WIFI_PASSWORD
} from "./helpers/fixtures";
import {repairIndexes} from "@/lib/redis/maintenance";
import {closeRedis, withRedis} from "@/lib/redis/client";
import {
    createCode,
    deleteFolder,
    deleteTemplate,
    getAsset,
    getCode,
    getMeta,
    getSettings,
    initMeta,
    listCodes,
    listFolders,
    listTags,
    listTemplates,
    MAX_ASSET_BYTES,
    purgeCode,
    putAsset,
    RepoError,
    retag,
    saveFolder,
    saveSettings,
    saveTemplate,
    scanCount,
    updateCode,
} from "@/lib/redis/repo";
import {SealError} from "@/lib/seal";
import {defaultStyle, settingsSchema} from "@/lib/schema";

beforeEach(async () => {
    vi.unstubAllEnvs();
    await T.reset();
    await initMeta();
});
afterAll(async () => {
    await T.cleanup();
    await closeRedis();
    await T.close();
});

const rejects = async (p: Promise<unknown>) => {
    try {
        await p;
    } catch (e) {
        return e as RepoError;
    }
    throw new Error("expected rejection");
};

it("does not replay a committed mutation when the socket response is lost", async () => {
    let calls = 0;
    await expect(withRedis(async (r) => {
        calls++;
        await r.incr(T.key("ambiguous-write"));
        throw new Error("Socket closed after commit");
    })).rejects.toThrow(/Redis/);
    expect(calls).toBe(1);
    expect(await (await T.raw()).get(T.key("ambiguous-write"))).toBe("1");
    expect(await getMeta()).not.toBeNull();
});
const members = async (rel: string) => (await (await T.raw()).sMembers(T.key(rel))).sort();
const cleanReport = async () => {
    const r = await repairIndexes(false);
    expect({...r, applied: undefined}).toEqual({
        codes: r.codes,
        corrupt: [],
        missingFromIndex: [],
        staleIndexEntries: [],
        slugFixed: 0,
        slugConflicts: [],
        folderFixed: 0,
        tagFixed: 0,
        orphanAssets: 0,
        applied: undefined
    });
};

describe("meta / writability", () => {
    it("initMeta is one-time and idempotent", async () => {
        const a = await getMeta();
        const b = await initMeta();
        expect(b).toEqual(a);
        expect(a).toMatchObject({schemaVersion: 1, instanceId: expect.any(String)});
    });
    it("blocks every write until the library is initialised (data-loss protection)", async () => {
        await T.reset();
        expect(await getMeta()).toBeNull();
        for (const op of [
            () => createCode(dynamicUrl({slug: "abcdef"})),
            () => saveFolder({name: "F"}),
            () => saveTemplate({name: "T", style: defaultStyle()}),
            () => saveSettings({}),
            () => putAsset(pngDataUrl()),
            () => purgeCode("abcdefgh1234"),
        ]) {
            expect(await rejects(op())).toMatchObject({code: "RECOVERY_REQUIRED"});
        }
        expect(await T.keys()).toEqual([]);
    });
});

describe("code CRUD", () => {
    it("creates a dynamic code with rev 1 and all derived indexes", async () => {
        const rec = await createCode(dynamicUrl({slug: "promo-1", tags: ["menu"], name: "  Spaced  "}));
        expect(rec).toMatchObject({
            rev: 1,
            slug: "promo-1",
            mode: "dynamic",
            name: "Spaced",
            status: "active",
            password: null
        });
        expect(rec.createdAt).toBe(rec.updatedAt);
        expect(await getCode(rec.id)).toEqual(rec);
        const r = await T.raw();
        expect(await r.get(T.key("slug:promo-1"))).toBe(rec.id);
        expect(await r.zScore(T.key("index:codes"), rec.id)).toBe(Date.parse(rec.createdAt));
        expect(await members("index:tags")).toEqual(["menu"]);
        expect(await members("index:tag:menu")).toEqual([rec.id]);
        await cleanReport();
    });
    it("auto-assigns a slug to dynamic codes and none to static codes", async () => {
        const d = await createCode(dynamicUrl());
        expect(d.slug).toMatch(/^[a-z0-9]{7}$/);
        const s = await createCode(staticText({slug: "ignored-slug"}));
        expect(s.slug).toBeNull();
        expect(await (await T.raw()).exists(T.key("slug:ignored-slug"))).toBe(0);
    });
    it("hashes passwords and never stores them in plain text", async () => {
        const rec = await createCode(dynamicUrl({password: "open-sesame"}));
        expect(rec.password?.hash).toMatch(/^scrypt\$/);
        expect(await (await T.raw()).get(T.key(`code:${rec.id}`))).not.toContain("open-sesame");
    });
    it("create is idempotent for a repeated offline opId", async () => {
        const input = dynamicUrl({id: "offlineid0001", opId: "op-1", slug: "offline-1"});
        const a = await createCode(input);
        const b = await createCode(input);
        expect(b).toEqual(a);
        expect((await listCodes()).records).toHaveLength(1);
        expect(await rejects(createCode({...input, opId: "op-2"}))).toMatchObject({code: "CONFLICT"});
        expect(await rejects(createCode({...input, opId: undefined}))).toMatchObject({code: "CONFLICT"});
    });
    it("rejects invalid content with precise errors", async () => {
        expect(await rejects(createCode(dynamicUrl({payload: "javascript:alert(1)"})))).toMatchObject({
            code: "BAD_REQUEST",
            message: expect.stringContaining("Only http and https")
        });
        expect(await rejects(createCode(dynamicUrl({payload: "https://qr.test/r/another"})))).toMatchObject({
            code: "BAD_REQUEST",
            message: expect.stringContaining("another QR Studio link")
        });
        expect(await rejects(createCode(dynamicUrl({payload: "http://10.0.0.1/"})))).toMatchObject({code: "BAD_REQUEST"});
        expect(await rejects(createCode(staticText({
            type: "wifi",
            mode: "dynamic"
        })))).toMatchObject({code: "BAD_REQUEST", message: "wifi codes cannot be dynamic"});
        expect(await rejects(createCode(staticText({fields: {text: "other"}})))).toMatchObject({
            code: "BAD_REQUEST",
            message: "Payload does not match the form fields"
        });
        expect(await rejects(createCode(staticText({fields: {text: ""}, payload: ""})))).toBeDefined();
        expect(await rejects(createCode(dynamicUrl({
            afterExpiry: {
                message: null,
                redirectUrl: "javascript:1"
            }
        })))).toMatchObject({code: "BAD_REQUEST"});
        expect(await rejects(createCode(dynamicUrl({
            schedule: {
                activateAt: "2030-01-02T00:00:00Z",
                expiresAt: "2030-01-01T00:00:00Z",
                expireAfterSeconds: null
            }
        })))).toMatchObject({message: "Expiry must be after activation"});
        expect(await rejects(createCode(dynamicUrl({folder: "nofolder00001"})))).toMatchObject({
            code: "BAD_REQUEST",
            message: "Folder does not exist"
        });
        expect(await rejects(createCode(staticText({
            payload: "x".repeat(3000),
            fields: {},
            style: {...defaultStyle(), ecc: "H"}
        })))).toMatchObject({code: "PAYLOAD_TOO_LARGE"});
        expect((await listCodes()).records).toHaveLength(0);
        expect(await (await T.raw()).zCard(T.key("index:codes"))).toBe(0);
    });

    describe("update", () => {
        it("increments rev, bumps updatedAt, keeps id/createdAt/opId immutable", async () => {
            vi.useFakeTimers({toFake: ["Date"]});
            try {
                vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
                const a = await createCode(dynamicUrl({id: "immutable0001", opId: "op-x", slug: "immut-1"}));
                vi.setSystemTime(new Date("2027-01-02T00:00:00Z"));
                const b = await updateCode(a.id, {
                    name: "Renamed", ifRev: 1, ...({
                        id: "hijacked00001",
                        createdAt: "1999-01-01T00:00:00Z",
                        rev: 99
                    } as object)
                });
                expect(b).toMatchObject({
                    id: a.id,
                    createdAt: a.createdAt,
                    opId: "op-x",
                    rev: 2,
                    name: "Renamed",
                    updatedAt: "2027-01-02T00:00:00.000Z"
                });
                expect(await getCode("hijacked00001")).toBeNull();
                const c = await updateCode(a.id, {favorite: true});
                expect(c.rev).toBe(3);
                expect(await getCode(a.id)).toEqual(c);
            } finally {
                vi.useRealTimers();
            }
        });
        it("only changes what is patched", async () => {
            const a = await createCode(dynamicUrl({
                slug: "partial-1",
                tags: ["x"],
                favorite: true,
                scanLimit: 5,
                analytics: false
            }));
            const b = await updateCode(a.id, {name: "N"});
            expect(b).toMatchObject({
                tags: ["x"],
                favorite: true,
                scanLimit: 5,
                analytics: false,
                slug: "partial-1",
                name: "N"
            });
        });
        it("REV_MISMATCH on a stale ifRev, and nothing is written", async () => {
            const a = await createCode(dynamicUrl({slug: "rev-test"}));
            await updateCode(a.id, {name: "v2", ifRev: 1});
            const e = await rejects(updateCode(a.id, {name: "stale", ifRev: 1}));
            expect(e).toMatchObject({code: "REV_MISMATCH", message: "This code was changed elsewhere"});
            expect((e.details as { current: { name: string; rev: number } }).current).toMatchObject({
                name: "v2",
                rev: 2
            });
            expect((await getCode(a.id))!.name).toBe("v2");
        });
        it("optimistic concurrency is atomic: 20 parallel edits from rev 1 -> exactly one wins", async () => {
            const a = await createCode(dynamicUrl({slug: "race-rev"}));
            const res = await Promise.allSettled(Array.from({length: 20}, (_, i) => updateCode(a.id, {
                name: `edit ${i}`,
                ifRev: 1
            })));
            expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
            for (const r of res) if (r.status === "rejected") expect(r.reason).toMatchObject({code: "REV_MISMATCH"});
            expect((await getCode(a.id))!.rev).toBe(2);
        });
        it("even without ifRev, concurrent read-modify-writes never lose a revision", async () => {
            const a = await createCode(dynamicUrl({slug: "race-norev"}));
            const res = await Promise.allSettled(Array.from({length: 10}, (_, i) => updateCode(a.id, {description: `d${i}`})));
            const won = res.filter((r) => r.status === "fulfilled").length;
            expect(won).toBeGreaterThanOrEqual(1);
            expect((await getCode(a.id))!.rev).toBe(1 + won);
        });
        it("NOT_FOUND for unknown ids", async () => {
            expect(await rejects(updateCode("nope00000001", {name: "x"}))).toMatchObject({code: "NOT_FOUND"});
        });
        it("moving slugs releases the old one and claims the new one", async () => {
            const a = await createCode(dynamicUrl({slug: "old-slug"}));
            await updateCode(a.id, {slug: "new-slug"});
            const r = await T.raw();
            expect(await r.exists(T.key("slug:old-slug"))).toBe(0);
            expect(await r.get(T.key("slug:new-slug"))).toBe(a.id);
            await cleanReport();
        });
        it("taking another code's slug fails with SLUG_TAKEN and leaves everything untouched", async () => {
            const a = await createCode(dynamicUrl({slug: "slug-a"}));
            const b = await createCode(dynamicUrl({slug: "slug-b"}));
            const before = await T.dump();
            expect(await rejects(updateCode(b.id, {slug: "slug-a"}))).toMatchObject({code: "SLUG_TAKEN"});
            expect(await T.dump()).toEqual(before);
            expect((await getCode(a.id))!.rev).toBe(1);
        });
        it("static -> dynamic assigns a slug; dynamic -> static releases it", async () => {
            const s = await createCode(dynamicUrl({mode: "static", payload: "https://example.com/page"}));
            expect(s.slug).toBeNull();
            const d = await updateCode(s.id, {mode: "dynamic"});
            expect(d.slug).toMatch(/^[a-z0-9]{7}$/);
            const r = await T.raw();
            expect(await r.get(T.key(`slug:${d.slug}`))).toBe(s.id);
            await cleanReport();
            const back = await updateCode(s.id, {mode: "static"});
            expect(back.slug).toBeNull();
            expect(await r.exists(T.key(`slug:${d.slug}`))).toBe(0);
            await cleanReport();
        });
        it("rejects an invalid dynamic transition (non-URL content)", async () => {
            const t = await createCode(staticText());
            expect(await rejects(updateCode(t.id, {mode: "dynamic"}))).toMatchObject({code: "BAD_REQUEST"});
            expect((await getCode(t.id))!.mode).toBe("static");
        });
        it("the slug stays reserved while a code is trashed, and is released on purge", async () => {
            const a = await createCode(dynamicUrl({slug: "reserved-1"}));
            await updateCode(a.id, {status: "trashed"});
            expect(await rejects(createCode(dynamicUrl({slug: "reserved-1"})))).toMatchObject({code: "SLUG_TAKEN"});
            expect(await purgeCode(a.id)).toBe(true);
            expect((await createCode(dynamicUrl({slug: "reserved-1"}))).slug).toBe("reserved-1");
        });
    });

    describe("slug uniqueness", () => {
        it("50 concurrent creates with the same slug: exactly one wins, the rest get SLUG_TAKEN", async () => {
            const res = await Promise.allSettled(Array.from({length: 50}, (_, i) => createCode(dynamicUrl({
                slug: "contested",
                name: `c${i}`
            }))));
            const won = res.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createCode>>> => r.status === "fulfilled");
            expect(won).toHaveLength(1);
            for (const r of res) if (r.status === "rejected") expect(r.reason).toMatchObject({code: "SLUG_TAKEN"});
            const r = await T.raw();
            expect(await r.get(T.key("slug:contested"))).toBe(won[0]!.value.id);
            expect(await r.zCard(T.key("index:codes"))).toBe(1);
            expect((await T.keys()).filter((k) => k.includes(":code:"))).toHaveLength(1);
            await cleanReport();
        });
        it("50 concurrent auto-slug creates all succeed with distinct slugs", async () => {
            const res = await Promise.all(Array.from({length: 50}, () => createCode(dynamicUrl())));
            expect(new Set(res.map((x) => x.slug)).size).toBe(50);
            await cleanReport();
        });
    });

    describe("trash and purge", () => {
        it("purge removes the record and every derived entry, including empty tag/folder sets", async () => {
            const f = await saveFolder({name: "Folder"});
            const a = await createCode(dynamicUrl({slug: "purge-me", tags: ["t1", "t2"], folder: f.id}));
            const keep = await createCode(dynamicUrl({slug: "keep-me", tags: ["t2"]}));
            expect(await members("index:tag:t2")).toEqual([a.id, keep.id].sort());
            await updateCode(a.id, {status: "trashed"});
            expect(await purgeCode(a.id)).toBe(true);
            const r = await T.raw();
            expect(await r.exists([T.key(`code:${a.id}`), T.key("slug:purge-me"), T.key(`count:${a.id}`), T.key("index:tag:t1"), T.key(`index:folder:${f.id}`)])).toBe(0);
            expect(await r.zScore(T.key("index:codes"), a.id)).toBeNull();
            expect(await members("index:tags")).toEqual(["t2"]);
            expect(await members("index:tag:t2")).toEqual([keep.id]);
            expect(await purgeCode(a.id)).toBe(false);
            await cleanReport();
        });
        it("refuses to purge a code that was restored from the trash", async () => {
            const code = await createCode(dynamicUrl({slug: "restored-code"}));
            await updateCode(code.id, {status: "trashed"});
            await updateCode(code.id, {status: "active"});

            expect(await rejects(purgeCode(code.id))).toMatchObject({code: "BAD_REQUEST"});
            expect(await getCode(code.id)).toMatchObject({status: "active"});
            expect(await (await T.raw()).get(T.key("slug:restored-code"))).toBe(code.id);
        });
        it("purge also drops the scan counter", async () => {
            const a = await createCode(dynamicUrl({slug: "counted-1"}));
            await (await T.raw()).set(T.key(`count:${a.id}`), "7");
            await updateCode(a.id, {status: "trashed"});
            await purgeCode(a.id);
            expect(await scanCount(a.id)).toBe(0);
        });
    });

    describe("index consistency through create / update / move / retag / purge", () => {
        it("stays verifiable-clean at every step", async () => {
            const f1 = await saveFolder({name: "One"});
            const f2 = await saveFolder({name: "Two"});
            const a = await createCode(dynamicUrl({slug: "idx-a", tags: ["a", "b"], folder: f1.id}));
            const b = await createCode(dynamicUrl({slug: "idx-b", tags: ["b"], folder: f1.id}));
            await cleanReport();
            expect(await members(`index:folder:${f1.id}`)).toEqual([a.id, b.id].sort());

            await updateCode(a.id, {tags: ["b", "c"], folder: f2.id});
            expect(await members(`index:folder:${f1.id}`)).toEqual([b.id]);
            expect(await members(`index:folder:${f2.id}`)).toEqual([a.id]);
            expect(await members("index:tags")).toEqual(["b", "c"]);
            expect(await (await T.raw()).exists(T.key("index:tag:a"))).toBe(0);
            await cleanReport();

            await updateCode(b.id, {folder: null});
            expect(await (await T.raw()).exists(T.key(`index:folder:${f1.id}`))).toBe(0);
            await cleanReport();

            expect(await retag("b", "z")).toBe(2);
            expect(await members("index:tags")).toEqual(["c", "z"]);
            await cleanReport();

            await updateCode(a.id, {status: "trashed"});
            await updateCode(b.id, {status: "trashed"});
            await purgeCode(a.id);
            await purgeCode(b.id);
            expect(await members("index:tags")).toEqual([]);
            expect(await (await T.raw()).zCard(T.key("index:codes"))).toBe(0);
            await cleanReport();
        });
        it("de-duplicates repeated tags", async () => {
            const a = await createCode(dynamicUrl({slug: "dup-tags", tags: ["x", "x", "y"]}));
            expect(a.tags).toEqual(["x", "y"]);
        });
    });
});

describe("folders", () => {
    it("creates, renames, recolors, lists with counts", async () => {
        const f = await saveFolder({name: " Work ", color: "#112233"});
        expect(f).toMatchObject({name: "Work", color: "#112233"});
        const a = await createCode(dynamicUrl({slug: "in-folder", folder: f.id}));
        const renamed = await saveFolder({id: f.id, name: "Office", color: null});
        expect(renamed).toMatchObject({id: f.id, name: "Office", color: null, createdAt: f.createdAt});
        expect(renamed.updatedAt >= f.updatedAt).toBe(true);
        expect(await listFolders()).toEqual([{...renamed, count: 1}]);
        expect(await rejects(saveFolder({id: "missing000001", name: "x"}))).toMatchObject({code: "NOT_FOUND"});
        expect(a.folder).toBe(f.id);
    });
    it("lists alphabetically", async () => {
        await saveFolder({name: "b"});
        await saveFolder({name: "a"});
        expect((await listFolders()).map((f) => f.name)).toEqual(["a", "b"]);
    });
    it("deleting a folder un-files its codes and never deletes them", async () => {
        const f = await saveFolder({name: "Temp"});
        const a = await createCode(dynamicUrl({slug: "f-1", folder: f.id}));
        const b = await createCode(dynamicUrl({slug: "f-2", folder: f.id}));
        expect(await deleteFolder(f.id)).toBe(2);
        expect((await getCode(a.id))).toMatchObject({folder: null, rev: 2});
        expect((await getCode(b.id))!.folder).toBeNull();
        expect(await listFolders()).toEqual([]);
        expect(await T.keys()).not.toContain(T.key(`folder:${f.id}`));
        await cleanReport();
    });
});

describe("tags", () => {
    it("lists with counts, renames, merges and deletes across codes", async () => {
        const a = await createCode(dynamicUrl({slug: "tag-a", tags: ["red", "shared"]}));
        const b = await createCode(dynamicUrl({slug: "tag-b", tags: ["blue", "shared"]}));
        expect(await listTags()).toEqual([{tag: "blue", count: 1}, {tag: "red", count: 1}, {tag: "shared", count: 2}]);
        expect(await retag("red", "crimson")).toBe(1);
        expect((await getCode(a.id))!.tags.sort()).toEqual(["crimson", "shared"]);
        expect(await retag("blue", "shared")).toBe(1);
        expect((await getCode(b.id))!.tags).toEqual(["shared"]);
        expect(await retag("shared", null)).toBe(2);
        expect((await getCode(a.id))!.tags).toEqual(["crimson"]);
        expect(await listTags()).toEqual([{tag: "crimson", count: 1}]);
        expect(await retag("never-used", "x")).toBe(0);
        await cleanReport();
    });
});

describe("templates", () => {
    it("create, update (id/createdAt kept), list, delete", async () => {
        const t = await saveTemplate({name: "Brand", style: {...defaultStyle(), fg: "#000000"}});
        const u = await saveTemplate({id: t.id, name: "Brand v2", style: {...defaultStyle(), fg: "#101010"}});
        expect(u).toMatchObject({id: t.id, name: "Brand v2", createdAt: t.createdAt});
        expect(await listTemplates()).toEqual([u]);
        expect(await rejects(saveTemplate({
            id: "missing000001",
            name: "x",
            style: defaultStyle()
        }))).toMatchObject({code: "NOT_FOUND"});
        await deleteTemplate(t.id);
        expect(await listTemplates()).toEqual([]);
        expect(await members("index:templates")).toEqual([]);
    });
    it("rejects an invalid style", async () => {
        await expect(saveTemplate({name: "bad", style: {fg: "red"}})).rejects.toThrow();
    });
});

describe("settings", () => {
    it("defaults, persists, validates", async () => {
        expect(await getSettings()).toEqual(settingsSchema.parse({}));
        const saved = await saveSettings({brand: {name: "Acme"}, analytics: {retentionDays: 30}});
        expect(saved.brand.name).toBe("Acme");
        expect(saved.updatedAt).toBeTruthy();
        expect(await getSettings()).toEqual(saved);
        await expect(saveSettings({analytics: {retentionDays: 1}})).rejects.toThrow();
        expect((await getSettings()).analytics.retentionDays).toBe(30);
    });
});

describe("assets (logos)", () => {
    it("stores PNG, JPEG and WebP content-addressed and dedupes", async () => {
        for (const url of [pngDataUrl(), jpegDataUrl(), webpDataUrl()]) {
            const id = await putAsset(url);
            expect(id).toMatch(/^[a-f0-9]{32}$/);
            expect(await putAsset(url)).toBe(id);
            expect(await getAsset(id)).toBe(url);
        }
        expect(await (await T.keys()).filter((k) => k.includes(":asset:"))).toHaveLength(3);
    });
    it("validates magic bytes against the declared type", async () => {
        const png = pngDataUrl().split(",")[1];
        for (const url of [`data:image/jpeg;base64,${png}`, `data:image/webp;base64,${png}`, `data:image/png;base64,${jpegDataUrl().split(",")[1]}`, `data:image/png;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`]) {
            expect(await rejects(putAsset(url))).toMatchObject({
                code: "BAD_REQUEST",
                message: "File contents do not match the declared image type"
            });
        }
    });
    it("rejects SVG and non-data-URL input", async () => {
        for (const url of [`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`, "data:image/svg+xml,<svg/>", "https://example.com/logo.png", "data:image/gif;base64,R0lGOD", "data:image/png;base64,@@@", ""]) {
            expect(await rejects(putAsset(url)), url).toMatchObject({code: "BAD_REQUEST"});
        }
    });
    it("enforces the size limit", async () => {
        expect(await putAsset(pngDataUrl(MAX_ASSET_BYTES - 8))).toMatch(/^[a-f0-9]{32}$/);
        expect(await rejects(putAsset(pngDataUrl(MAX_ASSET_BYTES - 7)))).toMatchObject({code: "PAYLOAD_TOO_LARGE"});
    });
    it("only serves well-formed hashes", async () => {
        expect(await getAsset("../../etc")).toBeNull();
        expect(await getAsset("a".repeat(32))).toBeNull();
        expect(await getAsset("ABC")).toBeNull();
    });
});

describe("sensitive types are sealed at rest", () => {
    const allStored = async () => JSON.stringify(await T.dump());

    it("a Wi-Fi password never appears in plain text anywhere under the prefix", async () => {
        const rec = await createCode(wifi());
        const raw = (await (await T.raw()).get(T.key(`code:${rec.id}`)))!;
        const stored = JSON.parse(raw);
        expect(stored).toMatchObject({payload: "sealed", fields: {}, type: "wifi", name: "Home wifi"});
        expect(typeof stored.sealed).toBe("string");
        for (const secret of [WIFI_PASSWORD, "Home Network", "WIFI:T:"]) {
            expect(raw).not.toContain(secret);
            expect(await allStored()).not.toContain(secret);
        }
        expect(await getCode(rec.id)).toEqual(rec);
        expect((await getCode(rec.id))!.fields).toMatchObject({password: WIFI_PASSWORD});
    });
    it("vCards are sealed too, and remain editable", async () => {
        const rec = await createCode(vcard());
        expect(await allStored()).not.toContain("Lovelace");
        const sealedBefore = JSON.parse((await (await T.raw()).get(T.key(`code:${rec.id}`)))!).sealed;
        const renamed = await updateCode(rec.id, {name: "Renamed"});
        expect(renamed.fields).toEqual(rec.fields);
        const sealedAfter = JSON.parse((await (await T.raw()).get(T.key(`code:${rec.id}`)))!).sealed;
        expect(sealedAfter).not.toBe(sealedBefore);
        expect(await allStored()).not.toContain("Lovelace");
    });
    it("listCodes decrypts, and does not seal non-sensitive types", async () => {
        await createCode(wifi());
        const t = await createCode(staticText());
        const {records} = await listCodes();
        expect(records.find((r) => r.type === "wifi")!.fields).toMatchObject({ssid: "Home Network"});
        expect(await (await T.raw()).get(T.key(`code:${t.id}`))).toContain("hello world");
    });
    it("is NOT_CONFIGURED without DATA_ENCRYPTION_KEY (and nothing is stored)", async () => {
        vi.stubEnv("DATA_ENCRYPTION_KEY", "");
        expect(await rejects(createCode(wifi()))).toMatchObject({code: "NOT_CONFIGURED"});
        expect(await rejects(createCode(vcard()))).toMatchObject({code: "NOT_CONFIGURED"});
        expect((await createCode(staticText())).type).toBe("text");
        expect((await T.keys()).filter((k) => k.includes(":code:"))).toHaveLength(1);
    });
    it("a sealed record cannot be read without the key (SealError) and lands in `unreadable`", async () => {
        const rec = await createCode(wifi());
        vi.stubEnv("DATA_ENCRYPTION_KEY", "");
        await expect(getCode(rec.id)).rejects.toBeInstanceOf(SealError);
        expect(await listCodes()).toMatchObject({records: [], unreadable: [rec.id]});
    });
    it("moving a sealed blob onto another record fails authentication", async () => {
        const a = await createCode(wifi({name: "A"}));
        const b = await createCode(wifi({
            name: "B",
            fields: {ssid: "Other", password: "otherpassword1", security: "WPA", hidden: false},
            payload: "WIFI:T:WPA;S:Other;P:otherpassword1;;"
        }));
        const r = await T.raw();
        const sa = JSON.parse((await r.get(T.key(`code:${a.id}`)))!);
        const sb = JSON.parse((await r.get(T.key(`code:${b.id}`)))!);
        await r.set(T.key(`code:${b.id}`), JSON.stringify({...sb, sealed: sa.sealed}));
        await expect(getCode(b.id)).rejects.toBeInstanceOf(SealError);
        await expect(getCode(a.id)).resolves.toMatchObject({name: "A"});
    });
});

describe("misc", () => {
    it("the stored DEST is returned byte-for-byte", async () => {
        const rec = await createCode(dynamicUrl({slug: "bytes-ok"}));
        expect((await getCode(rec.id))!.payload).toBe(DEST);
    });
});
