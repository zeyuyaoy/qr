import {describe, expect, it} from "vitest";
import {type LibraryQuery, queryLibrary} from "@/lib/library-query";
import {LIBRARY_FORMAT} from "@/lib/library-format";
import {libraryFileSchema} from "@/lib/redis/maintenance";
import {MAX_CODES} from "@/lib/redis/repo";
import {defaultStyle, type QrView} from "@/lib/schema";

let n = 0;
const view = (o: Partial<QrView> = {}): QrView => {
    n++;
    return {
        v: 1,
        id: `id${String(n).padStart(8, "0")}`,
        name: `Code ${n}`,
        description: "",
        type: "url",
        mode: "static",
        fields: {},
        payload: "https://example.com",
        slug: null,
        style: defaultStyle(),
        tags: [],
        folder: null,
        favorite: false,
        pinned: false,
        status: "active",
        enabled: true,
        schedule: {activateAt: null, expiresAt: null, expireAfterSeconds: null},
        scanLimit: null,
        afterExpiry: {message: null, redirectUrl: null},
        analytics: true,
        rev: 1,
        createdAt: "2027-01-01T00:00:00.000Z",
        updatedAt: "2027-01-01T00:00:00.000Z",
        hasPassword: false,
        scans: 0,
        linkState: "ok",
        ...o,
    };
};
const names = (items: QrView[], q: LibraryQuery = {}) => queryLibrary(items, q).map((v) => v.name);

describe("queryLibrary filters", () => {
    const items = [
        view({
            name: "Menu",
            type: "url",
            mode: "dynamic",
            slug: "menu-x",
            payload: "https://cafe.example/menu",
            tags: ["food", "print"],
            folder: "f1",
            favorite: true,
            linkState: "ok",
            scans: 5
        }),
        view({
            name: "Wifi guest",
            type: "wifi",
            payload: "WIFI:T:WPA;S:Guest;P:topsecret99;;",
            tags: ["office"],
            folder: "f2",
            linkState: "ok"
        }),
        view({
            name: "Old promo",
            type: "url",
            mode: "dynamic",
            slug: "promo",
            description: "Spring sale",
            status: "archived",
            linkState: "paused"
        }),
        view({name: "Gone", status: "trashed", linkState: "removed"}),
        view({name: "Expired deal", type: "url", mode: "dynamic", slug: "deal", linkState: "expired", scans: 9}),
    ];
    it("defaults to active items only", () => {
        expect(names(items, {sort: "name"})).toEqual(["Expired deal", "Menu", "Wifi guest"]);
    });
    it.each<[string, LibraryQuery, string[]]>([
        ["status archived", {status: "archived"}, ["Old promo"]],
        ["status trashed", {status: "trashed"}, ["Gone"]],
        ["status all", {status: "all"}, ["Expired deal", "Gone", "Menu", "Old promo", "Wifi guest"]],
        ["type", {type: "wifi"}, ["Wifi guest"]],
        ["mode dynamic", {mode: "dynamic", status: "all"}, ["Expired deal", "Menu", "Old promo"]],
        ["folder id", {folder: "f1"}, ["Menu"]],
        ["folder none", {folder: "none"}, ["Expired deal"]],
        ["tag", {tag: "office"}, ["Wifi guest"]],
        ["favorite", {favorite: true}, ["Menu"]],
        ["link state", {state: "expired"}, ["Expired deal"]],
        ["combined", {mode: "dynamic", state: "ok"}, ["Menu"]],
        ["no match", {tag: "zzz"}, []],
    ])("%s", (_l, q, out) => {
        expect(names(items, {...q, sort: "name"})).toEqual(out);
    });

    describe("search", () => {
        it("matches name, description, slug, tags, type and dynamic destinations case-insensitively", () => {
            expect(names(items, {q: "MENU"})).toEqual(["Menu"]);
            expect(names(items, {q: "spring", status: "all"})).toEqual(["Old promo"]);
            expect(names(items, {q: "deal"})).toEqual(["Expired deal"]);
            expect(names(items, {q: "print"})).toEqual(["Menu"]);
            expect(names(items, {q: "wifi"})).toEqual(["Wifi guest"]);
            expect(names(items, {q: "cafe.example"})).toEqual(["Menu"]);
            expect(names(items, {q: "  menu  "})).toEqual(["Menu"]);
        });
        it("never searches static payloads (they may hold Wi-Fi passwords)", () => {
            expect(names(items, {q: "topsecret99"})).toEqual([]);
            expect(names(items, {q: "WIFI:T"})).toEqual([]);
        });
        it("an empty search matches everything", () => {
            expect(names(items, {q: "   "})).toHaveLength(3);
        });
    });
});

describe("queryLibrary ordering", () => {
    const mk = () => [
        view({name: "b", scans: 5, createdAt: "2027-01-02T00:00:00.000Z", updatedAt: "2027-03-01T00:00:00.000Z"}),
        view({name: "a", scans: 9, createdAt: "2027-01-03T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z"}),
        view({name: "c", scans: 1, createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-02-01T00:00:00.000Z"}),
        view({
            name: "p",
            pinned: true,
            scans: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        }),
    ];
    it("defaults to most recently updated first, pinned always first", () => {
        expect(names(mk())).toEqual(["p", "b", "c", "a"]);
    });
    it.each<[LibraryQuery, string[]]>([
        [{sort: "updated", dir: "asc"}, ["p", "a", "c", "b"]],
        [{sort: "created"}, ["p", "a", "b", "c"]],
        [{sort: "created", dir: "asc"}, ["p", "c", "b", "a"]],
        [{sort: "name"}, ["p", "a", "b", "c"]],
        [{sort: "name", dir: "desc"}, ["p", "c", "b", "a"]],
        [{sort: "scans"}, ["p", "a", "b", "c"]],
        [{sort: "scans", dir: "asc"}, ["p", "c", "b", "a"]],
    ])("%j", (q, out) => expect(names(mk(), q)).toEqual(out));
    it("does not mutate the input", () => {
        const input = mk();
        const copy = [...input];
        queryLibrary(input, {sort: "name"});
        expect(input).toEqual(copy);
    });
    it("sorts several pinned items among themselves", () => {
        const items = [view({name: "x", pinned: true, updatedAt: "2027-01-01T00:00:00.000Z"}), view({
            name: "y",
            pinned: true,
            updatedAt: "2027-02-01T00:00:00.000Z"
        }), view({name: "z"})];
        expect(names(items)).toEqual(["y", "x", "z"]);
    });
});

describe("library file schema", () => {
    const minimal = {format: LIBRARY_FORMAT, version: 1, exportedAt: "2027-01-01T00:00:00.000Z", codes: []};
    it("accepts a minimal file and defaults folders/templates", () => {
        const f = libraryFileSchema.parse(minimal);
        expect(f.folders).toEqual([]);
        expect(f.templates).toEqual([]);
    });
    it("keeps the format constant stable", () => {
        expect(LIBRARY_FORMAT).toBe("qr-studio-library");
    });
    it("rejects anything that is not a library file", () => {
        for (const bad of [null, "x", {}, {...minimal, format: "other"}, {...minimal, version: 2}, {
            ...minimal,
            codes: "x"
        }, {...minimal, exportedAt: undefined}, {...minimal, folders: [{id: "x"}]}]) {
            expect(libraryFileSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
        }
    });
    it("caps the number of codes", () => {
        expect(libraryFileSchema.safeParse({...minimal, codes: new Array(MAX_CODES).fill(null)}).success).toBe(true);
        expect(libraryFileSchema.safeParse({
            ...minimal,
            codes: new Array(MAX_CODES + 1).fill(null)
        }).success).toBe(false);
    });
    it("leaves code validation to per-row import (so one bad row does not reject the file)", () => {
        expect(libraryFileSchema.safeParse({...minimal, codes: [{nonsense: true}, 5]}).success).toBe(true);
    });
});

describe("CSV library input", () => {
    it("imports URL payloads, quoted names and tags with safe defaults", async () => {
        const {libraryFromCsv} = await import("@/lib/library-csv");
        const f = libraryFromCsv('name,url,tags\r\n"Menu, dinner",https://example.com/menu,food|print');
        expect(f.codes).toHaveLength(1);
        expect(f.codes[0]).toMatchObject({
            name: "Menu, dinner",
            payload: "https://example.com/menu",
            tags: ["food", "print"],
            enabled: false
        });
        expect(libraryFileSchema.safeParse(f).success).toBe(true);
    });
    it("rejects redacted or unsupported CSV rather than silently losing data", async () => {
        const {libraryFromCsv} = await import("@/lib/library-csv");
        expect(() => libraryFromCsv("name,value\nTest,hello")).toThrow(/needs/);
        expect(() => libraryFromCsv("destination_or_payload\n(sensitive — see JSON export)")).toThrow(/redacts/);
    });
});
