import {T} from "./helpers/boot";
import {afterAll, beforeEach, describe, expect, it} from "vitest";
import {normalize, type Seeded, seedLibrary} from "./helpers/seed";
import {DEST, dynamicUrl, pngDataUrl, staticText, wifi} from "./helpers/fixtures";
import {closeRedis} from "@/lib/redis/client";
import {importLibrary, LIBRARY_FORMAT, repairIndexes} from "@/lib/redis/maintenance";
import {
    createCode,
    getCode,
    initMeta,
    listCodes,
    listFolders,
    listTemplates,
    putAsset,
    RepoError,
    resolveSlug
} from "@/lib/redis/repo";
import {defaultStyle} from "@/lib/schema";

let seeded: Seeded;
beforeEach(async () => {
    await T.reset();
    await initMeta();
});
afterAll(async () => {
    await T.cleanup();
    await closeRedis();
    await T.close();
});

describe("repairIndexes", () => {
    beforeEach(async () => {
        seeded = await seedLibrary();
    });
    const clean = {
        corrupt: [],
        missingFromIndex: [],
        staleIndexEntries: [],
        slugFixed: 0,
        slugConflicts: [],
        folderFixed: 0,
        tagFixed: 0,
        orphanAssets: 0
    };

    it("a healthy library verifies clean (dry run and apply)", async () => {
        expect(await repairIndexes(false)).toMatchObject({...clean, codes: 6, applied: false});
        const before = normalize(await T.dump());
        expect(await repairIndexes(true)).toMatchObject({...clean, applied: true});
        expect(normalize(await T.dump())).toEqual(before);
    });

    it("detects deliberately damaged indexes in a dry run (without changing anything) and fixes them on apply", async () => {
        const r = await T.raw();
        const {alpha, beta, gamma, work} = seeded;
        await r.del(T.key("slug:bk-alpha"));
        await r.zAdd(T.key("index:codes"), {score: 1, value: "ghostcode0001"});
        await r.zRem(T.key("index:codes"), beta.id);
        await r.set(T.key("slug:stale-slug"), "ghostcode0001");
        await r.set(T.key("slug:bk-beta"), alpha.id);
        await r.sRem(T.key("index:tag:t2"), alpha.id);
        await r.sAdd(T.key("index:tag:t2"), "ghostcode0002");
        await r.sAdd(T.key("index:tag:orphan-tag"), alpha.id);
        await r.sAdd(T.key(`index:folder:${work.id}`), gamma.id);
        await r.sRem(T.key(`index:folder:${work.id}`), alpha.id);
        await r.sAdd(T.key("index:tags"), "orphan-tag");
        const orphan = await putAsset(pngDataUrl(40));
        const damaged = await T.dump();

        const dry = await repairIndexes(false);
        expect(dry).toMatchObject({
            applied: false,
            missingFromIndex: [beta.id],
            staleIndexEntries: ["ghostcode0001"],
            orphanAssets: 1,
            codes: 6
        });
        expect(dry.slugFixed).toBeGreaterThanOrEqual(3);
        expect(dry.tagFixed).toBeGreaterThanOrEqual(2);
        expect(dry.folderFixed).toBeGreaterThanOrEqual(1);
        expect(await T.dump()).toEqual(damaged);

        const applied = await repairIndexes(true);
        expect(applied.applied).toBe(true);
        expect(await repairIndexes(false)).toMatchObject({...clean});
        expect((await resolveSlug("bk-alpha"))!.record.id).toBe(alpha.id);
        expect((await resolveSlug("bk-beta"))!.record.id).toBe(beta.id);
        expect(await resolveSlug("stale-slug")).toBeNull();
        expect(await r.zScore(T.key("index:codes"), beta.id)).toBe(Date.parse(beta.createdAt));
        expect(await r.zScore(T.key("index:codes"), "ghostcode0001")).toBeNull();
        expect((await r.sMembers(T.key("index:tags"))).sort()).toEqual(["t1", "t2", "t3"]);
        expect(await r.exists(T.key("index:tag:orphan-tag"))).toBe(0);
        expect((await r.sMembers(T.key(`index:folder:${work.id}`))).sort()).toEqual([alpha.id]);
        expect(await r.exists(T.key(`asset:${orphan}`))).toBe(0);
        expect(await r.exists(T.key(`asset:${seeded.assetId}`))).toBe(1);
    });

    it("reports slug conflicts (oldest code keeps the slug) and does not touch other records", async () => {
        const r = await T.raw();
        const stored = JSON.parse((await r.get(T.key(`code:${seeded.alpha.id}`)))!);
        const twin = {...stored, id: "twincode00001", name: "Twin", createdAt: "2099-01-01T00:00:00.000Z"};
        await r.set(T.key(`code:${twin.id}`), JSON.stringify(twin));
        const rep = await repairIndexes(true);
        expect(rep.slugConflicts).toEqual([{slug: "bk-alpha", keptId: seeded.alpha.id, droppedId: "twincode00001"}]);
        expect(await r.get(T.key("slug:bk-alpha"))).toBe(seeded.alpha.id);
        expect(await getCode(twin.id)).toMatchObject({name: "Twin"});
    });

    it("flags unreadable records without deleting them", async () => {
        const r = await T.raw();
        await r.set(T.key(`code:${seeded.eps.id}`), "{broken");
        const rep = await repairIndexes(false);
        expect(rep.corrupt).toEqual([seeded.eps.id]);
        await repairIndexes(true);
        expect(await r.get(T.key(`code:${seeded.eps.id}`))).toBe("{broken");
    });

    it("apply requires an initialised library, dry run does not", async () => {
        await T.reset();
        await expect(repairIndexes(true)).rejects.toMatchObject({code: "RECOVERY_REQUIRED"});
        expect(await repairIndexes(false)).toMatchObject({codes: 0});
    });
});

describe("importLibrary", () => {
    const exported = async () => {
        const s = await seedLibrary();
        const {records} = await listCodes();
        return {
            s,
            file: {
                format: LIBRARY_FORMAT,
                version: 1,
                exportedAt: new Date().toISOString(),
                codes: records.map(({password, ...r}) => ({...r, password: null, hadPassword: Boolean(password)})),
                folders: (await listFolders()).map(({count, ...f}) => (void count, f)),
                templates: await listTemplates(),
            },
        };
    };

    it("dry run validates and counts without writing", async () => {
        const {file} = await exported();
        await T.reset();
        await initMeta();
        const before = await T.dump();
        const rep = await importLibrary(file, {dryRun: true, policy: "skip"});
        expect(rep).toMatchObject({
            dryRun: true,
            created: 6,
            updated: 0,
            skipped: 0,
            invalid: [],
            slugConflicts: [],
            folders: 2,
            templates: 1
        });
        expect(await T.dump()).toEqual(before);
    });

    it("apply recreates everything; passwords are never imported, secrets are sealed again", async () => {
        const {file, s} = await exported();
        await T.reset();
        await initMeta();
        const rep = await importLibrary(file, {dryRun: false, policy: "skip"});
        expect(rep).toMatchObject({created: 6, invalid: [], skipped: 0});
        const alpha = (await getCode(s.alpha.id))!;
        expect(alpha.password).toBeNull();
        expect(alpha.slug).toBe("bk-alpha");
        expect((await getCode(s.gamma.id))!.fields).toMatchObject({ssid: "Home Network"});
        expect(await (await T.raw()).get(T.key(`code:${s.gamma.id}`))).not.toContain("hunter2");
        expect((await repairIndexes(false)).missingFromIndex).toEqual([]);
        expect((await resolveSlug("bk-alpha"))!.record.id).toBe(s.alpha.id);
    });

    it("ignores a password hash smuggled into the file", async () => {
        const file = {
            format: LIBRARY_FORMAT,
            version: 1,
            exportedAt: "x",
            codes: [{
                ...(await createCode(dynamicUrl({slug: "smuggle-1"}))),
                id: "smuggled00001",
                slug: "smuggle-2",
                password: {hash: "scrypt$16384$8$1$AAAA$BBBB", setAt: "2027-01-01T00:00:00.000Z"}
            }]
        };
        await importLibrary(file, {dryRun: false, policy: "skip"});
        expect((await getCode("smuggled00001"))!.password).toBeNull();
    });

    describe("policies on re-import", () => {
        it("skip keeps existing records", async () => {
            const {file, s} = await exported();
            const edited = {
                ...file,
                codes: file.codes.map((c) => (c.id === s.alpha.id ? {...c, name: "From file"} : c))
            };
            const rep = await importLibrary(edited, {dryRun: false, policy: "skip"});
            expect(rep).toMatchObject({created: 0, skipped: 6, updated: 0});
            expect((await getCode(s.alpha.id))!.name).toBe("Alpha Menu");
        });
        it("overwrite replaces by id and bumps the revision", async () => {
            const {file, s} = await exported();
            const edited = {
                ...file,
                codes: file.codes.map((c) => (c.id === s.alpha.id ? {...c, name: "From file"} : c))
            };
            const rep = await importLibrary(edited, {dryRun: false, policy: "overwrite"});
            expect(rep).toMatchObject({created: 0, updated: 6});
            expect(await getCode(s.alpha.id)).toMatchObject({name: "From file", rev: s.alpha.rev + 1});
            expect((await repairIndexes(false)).slugFixed).toBe(0);
        });
        it("duplicate imports everything as new codes with fresh ids and slugs", async () => {
            const {file, s} = await exported();
            const before = (await listCodes()).records.length;
            const rep = await importLibrary(file, {dryRun: false, policy: "duplicate"});
            expect(rep).toMatchObject({created: 6, skipped: 0, slugConflicts: []});
            const after = (await listCodes()).records;
            expect(after).toHaveLength(before + 6);
            const copies = after.filter((r) => r.name.endsWith("(imported)"));
            expect(copies).toHaveLength(6);
            expect(new Set(copies.map((c) => c.id)).size).toBe(6);
            expect(copies.every((c) => c.rev === 1)).toBe(true);
            const dynamicCopies = copies.filter((c) => c.mode === "dynamic");
            expect(dynamicCopies.every((c) => c.slug && !["bk-alpha", "bk-beta", "bk-old"].includes(c.slug))).toBe(true);
            expect((await getCode(s.alpha.id))!.name).toBe("Alpha Menu");
            expect((await repairIndexes(false)).slugFixed).toBe(0);
        });
        it("reports a slug conflict when another code owns the slug", async () => {
            await createCode(dynamicUrl({slug: "taken-slug", name: "Squatter"}));
            const rep = await importLibrary(
                {
                    format: LIBRARY_FORMAT,
                    version: 1,
                    exportedAt: "x",
                    codes: [{
                        ...(await createCode(dynamicUrl({slug: "other-slug"}))),
                        id: "importedid001",
                        slug: "taken-slug"
                    }]
                },
                {dryRun: false, policy: "skip"},
            );
            expect(rep.slugConflicts).toEqual([{id: "importedid001", slug: "taken-slug"}]);
            expect(rep.created).toBe(0);
            expect(await getCode("importedid001")).toBeNull();
        });
    });

    it("reports invalid rows by index without aborting the rest", async () => {
        const good = {...(await createCode(staticText({name: "good source"}))), id: "goodrow000001"};
        const dynamic = await createCode(dynamicUrl({slug: "template-src"}));
        const file = {
            format: LIBRARY_FORMAT,
            version: 1,
            exportedAt: "x",
            codes: [
                {nonsense: true},
                good,
                {...dynamic, id: "evildest00001", slug: "evil-dest", name: "Evil", payload: "javascript:alert(1)"},
                {...good, id: "badpayload0001", name: "Mismatch", payload: "different"},
                {...good, id: "futurerow0001", v: 2},
                "not an object",
                {
                    ...dynamic,
                    id: "toolarge00001",
                    slug: "too-large",
                    mode: "static",
                    name: "Big",
                    fields: {},
                    payload: "x".repeat(3500),
                    style: {...defaultStyle(), ecc: "H"}
                },
            ],
        };
        const dry = await importLibrary(file, {dryRun: true, policy: "skip"});
        expect(dry.created).toBe(1);
        expect(dry.invalid.map((i) => i.index)).toEqual([0, 2, 3, 4, 5, 6]);
        expect(dry.invalid.find((i) => i.index === 2)).toMatchObject({
            name: "Evil",
            error: expect.stringContaining("Only http and https")
        });
        expect(dry.invalid.find((i) => i.index === 3)).toMatchObject({
            name: "Mismatch",
            error: "Payload does not match the form fields"
        });
        expect(dry.invalid.find((i) => i.index === 6)).toMatchObject({error: expect.stringContaining("does not fit")});
        for (const bad of dry.invalid) expect(bad.error.length).toBeGreaterThan(0);
        expect(dry.invalid.filter((i) => i.index !== 6 && i.index !== 2 && i.index !== 3).every((i) => i.name === undefined)).toBe(true);
        await importLibrary(file, {dryRun: false, policy: "skip"});
        expect(await getCode("goodrow000001")).not.toBeNull();
        expect(await getCode("evildest00001")).toBeNull();
    });

    it("rejects files that are not library exports", async () => {
        for (const bad of [null, {}, {format: "nope", version: 1, exportedAt: "x", codes: []}, {
            format: LIBRARY_FORMAT,
            version: 2,
            exportedAt: "x",
            codes: []
        }, {format: LIBRARY_FORMAT, version: 1, exportedAt: "x", codes: "x"}]) {
            await expect(importLibrary(bad, {dryRun: true, policy: "skip"})).rejects.toMatchObject({
                code: "BAD_REQUEST",
                message: "Not a QR Studio library file"
            });
        }
        await expect(importLibrary(null, {dryRun: true, policy: "skip"})).rejects.toBeInstanceOf(RepoError);
    });

    it("applying requires an initialised library; dry run does not", async () => {
        await T.reset();
        const file = {format: LIBRARY_FORMAT, version: 1, exportedAt: "x", codes: []};
        await expect(importLibrary(file, {
            dryRun: false,
            policy: "skip"
        })).rejects.toMatchObject({code: "RECOVERY_REQUIRED"});
        await expect(importLibrary(file, {dryRun: true, policy: "skip"})).resolves.toMatchObject({created: 0});
    });

    it("sensitive imports without DATA_ENCRYPTION_KEY are reported invalid, never stored in plain text", async () => {
        const w = await createCode(wifi());
        const file = {
            format: LIBRARY_FORMAT,
            version: 1,
            exportedAt: "x",
            codes: [{...(await getCode(w.id))!, id: "wifiimport001", password: null}]
        };
        const key = process.env.DATA_ENCRYPTION_KEY;
        process.env.DATA_ENCRYPTION_KEY = "";
        try {
            const rep = await importLibrary(file, {dryRun: false, policy: "skip"});
            expect(rep.invalid).toHaveLength(1);
            expect(rep.invalid[0]!.error).toMatch(/DATA_ENCRYPTION_KEY/);
        } finally {
            process.env.DATA_ENCRYPTION_KEY = key;
        }
        expect(await (await T.raw()).exists(T.key("code:wifiimport001"))).toBe(0);
        expect(DEST).toBeTruthy();
    });
});
