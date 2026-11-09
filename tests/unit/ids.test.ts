import {describe, expect, it} from "vitest";
import {newId, newOpId, newSlug, slugify} from "@/lib/ids";
import {idSchema, slugSchema} from "@/lib/schema";

describe("ids", () => {
    it("newId: 14 chars of [a-z0-9], valid per idSchema", () => {
        for (let i = 0; i < 200; i++) {
            const id = newId();
            expect(id).toMatch(/^[a-z0-9]{14}$/);
            expect(idSchema.safeParse(id).success).toBe(true);
        }
    });
    it("newOpId: 16 chars, fits the opId limit", () => {
        expect(newOpId()).toMatch(/^[a-z0-9]{16}$/);
    });
    it("is unique over 10,000 draws", () => {
        expect(new Set(Array.from({length: 10_000}, newId)).size).toBe(10_000);
        expect(new Set(Array.from({length: 10_000}, () => newSlug(10))).size).toBe(10_000);
    });
    it("newSlug: default 7, configurable length, no look-alike characters", () => {
        expect(newSlug()).toHaveLength(7);
        expect(newSlug(9)).toHaveLength(9);
        expect(newSlug(0)).toBe("");
        const all = Array.from({length: 5_000}, () => newSlug()).join("");
        expect(all).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]+$/);
        expect(all).not.toMatch(/[01oli]/);
        expect(new Set(all).size).toBe(31);
    });
    it("generated slugs satisfy slugSchema", () => {
        for (let i = 0; i < 200; i++) expect(slugSchema.safeParse(newSlug()).success).toBe(true);
    });
    it("is roughly uniform over the alphabet", () => {
        const counts = new Map<string, number>();
        const draws = 62_000;
        for (const c of Array.from({length: draws / 31}, () => newSlug(31)).join("")) counts.set(c, (counts.get(c) ?? 0) + 1);
        const expected = draws / 31;
        for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.12);
    });
});

describe("slugify", () => {
    it.each([
        ["Hello World", "hello-world"],
        ["  --Spring Menu 2027--  ", "spring-menu-2027"],
        ["Crème Brûlée / Café", "creme-brulee-cafe"],
        ["a__b--c", "a__b--c"],
        ["Ünïcödé", "unicode"],
        ["日本語", ""],
        ["!!!", ""],
        ["A/B C", "a-b-c"],
    ])("%j -> %j", (i, o) => expect(slugify(i)).toBe(o));
    it("caps at 64 characters", () => {
        expect(slugify("x".repeat(100))).toHaveLength(64);
    });
    it("produces schema-valid slugs for ordinary titles", () => {
        for (const t of ["My QR code", "Menu – Table 4", "Q3 report (final)"]) expect(slugSchema.safeParse(slugify(t)).success, t).toBe(true);
    });
});
