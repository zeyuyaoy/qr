import {describe, expect, it} from "vitest";
import {effectiveExpiry, evaluateLink, isRetired} from "@/lib/expiry";
import type {QrRecord} from "@/lib/schema";

type T = Parameters<typeof evaluateLink>[0];
const NOW = Date.parse("2027-06-01T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const rec = (o: Partial<Omit<T, "schedule">> & { schedule?: Partial<QrRecord["schedule"]> } = {}): T => ({
    status: "active",
    enabled: true,
    createdAt: "2027-01-01T00:00:00.000Z",
    scanLimit: null,
    mode: "dynamic",
    ...o,
    schedule: {activateAt: null, expiresAt: null, expireAfterSeconds: null, ...o.schedule},
});
const kind = (r: T, scans = 0, now = NOW) => evaluateLink(r, now, scans).kind;

describe("evaluateLink", () => {
    it("is ok for a plain active link", () => {
        expect(evaluateLink(rec(), NOW, 0)).toEqual({kind: "ok"});
        expect(kind(rec(), 1_000_000)).toBe("ok");
    });

    describe("precedence", () => {
        const everything = rec({
            status: "trashed",
            enabled: false,
            scanLimit: 1,
            schedule: {activateAt: iso(NOW + 1000), expiresAt: iso(NOW - 1000)},
        });
        it("trashed > archived/disabled > not_yet > expired > exhausted", () => {
            expect(kind(everything, 5)).toBe("removed");
            expect(kind({...everything, status: "archived"}, 5)).toBe("paused");
            expect(kind({...everything, status: "active"}, 5)).toBe("paused");
            expect(kind({...everything, status: "active", enabled: true}, 5)).toBe("not_yet");
            expect(kind({
                ...everything,
                status: "active",
                enabled: true,
                schedule: {...everything.schedule, activateAt: null}
            }, 5)).toBe("expired");
            expect(kind({
                ...everything,
                status: "active",
                enabled: true,
                schedule: {...everything.schedule, activateAt: null, expiresAt: null}
            }, 5)).toBe("exhausted");
        });
        it("trashed beats archived", () => {
            expect(kind(rec({status: "trashed", enabled: true}))).toBe("removed");
        });
    });

    describe("activation", () => {
        it("is not_yet strictly before activateAt, ok exactly at it", () => {
            const at = iso(NOW);
            expect(kind(rec({schedule: {activateAt: at}}), 0, NOW - 1)).toBe("not_yet");
            expect(kind(rec({schedule: {activateAt: at}}), 0, NOW)).toBe("ok");
            expect(kind(rec({schedule: {activateAt: at}}), 0, NOW + 1)).toBe("ok");
            expect(evaluateLink(rec({schedule: {activateAt: at}}), NOW - 1, 0)).toEqual({
                kind: "not_yet",
                activateAt: at
            });
        });
    });

    describe("absolute expiry", () => {
        it("is ok one ms before, expired exactly at expiresAt", () => {
            const r = rec({schedule: {expiresAt: iso(NOW)}});
            expect(kind(r, 0, NOW - 1)).toBe("ok");
            expect(evaluateLink(r, NOW, 0)).toEqual({kind: "expired", at: iso(NOW)});
            expect(kind(r, 0, NOW + 1)).toBe("expired");
        });
    });

    describe("relative expiry", () => {
        const created = "2027-01-01T00:00:00.000Z";
        it("is anchored on createdAt when there is no activateAt", () => {
            const r = rec({createdAt: created, schedule: {expireAfterSeconds: 3600}});
            const end = Date.parse(created) + 3600_000;
            expect(kind(r, 0, end - 1)).toBe("ok");
            expect(kind(r, 0, end)).toBe("expired");
        });
        it("is anchored on activateAt when set", () => {
            const act = Date.parse("2027-02-01T00:00:00.000Z");
            const r = rec({createdAt: created, schedule: {activateAt: iso(act), expireAfterSeconds: 3600}});
            expect(kind(r, 0, act - 1)).toBe("not_yet");
            expect(kind(r, 0, act)).toBe("ok");
            expect(kind(r, 0, act + 3600_000 - 1)).toBe("ok");
            expect(kind(r, 0, act + 3600_000)).toBe("expired");
        });
        it("takes the earlier of absolute and relative expiry", () => {
            const act = NOW - 1000;
            const relEnd = act + 60_000;
            const earlierAbs = rec({
                schedule: {
                    activateAt: iso(act),
                    expiresAt: iso(relEnd - 1),
                    expireAfterSeconds: 60
                }
            });
            const earlierRel = rec({
                schedule: {
                    activateAt: iso(act),
                    expiresAt: iso(relEnd + 5000),
                    expireAfterSeconds: 60
                }
            });
            expect(effectiveExpiry(earlierAbs)).toBe(relEnd - 1);
            expect(effectiveExpiry(earlierRel)).toBe(relEnd);
            expect(kind(earlierRel, 0, relEnd)).toBe("expired");
            expect(kind(earlierRel, 0, relEnd - 1)).toBe("ok");
        });
        it("reports the effective expiry instant", () => {
            const r = rec({createdAt: created, schedule: {expireAfterSeconds: 60}});
            expect(evaluateLink(r, Date.parse(created) + 120_000, 0)).toEqual({
                kind: "expired",
                at: "2027-01-01T00:01:00.000Z"
            });
        });
    });

    describe("scan limit", () => {
        it("is exhausted when accepted scans reach the limit", () => {
            const r = rec({scanLimit: 10});
            expect(kind(r, 0)).toBe("ok");
            expect(kind(r, 9)).toBe("ok");
            expect(kind(r, 10)).toBe("exhausted");
            expect(kind(r, 11)).toBe("exhausted");
        });
        it("a limit of 1 allows exactly one scan", () => {
            expect(kind(rec({scanLimit: 1}), 0)).toBe("ok");
            expect(kind(rec({scanLimit: 1}), 1)).toBe("exhausted");
        });
        it("never exhausts without a limit", () => {
            expect(kind(rec({scanLimit: null}), Number.MAX_SAFE_INTEGER)).toBe("ok");
        });
        it("expiry wins over exhaustion so the expired experience is shown", () => {
            expect(kind(rec({scanLimit: 1, schedule: {expiresAt: iso(NOW - 1)}}), 5)).toBe("expired");
        });
    });
});

describe("effectiveExpiry", () => {
    it("is null without any expiry", () => {
        expect(effectiveExpiry(rec())).toBeNull();
    });
    it("ignores a zero/null relative duration", () => {
        expect(effectiveExpiry(rec({schedule: {expireAfterSeconds: null}}))).toBeNull();
    });
});

describe("isRetired", () => {
    it("is true only for expired and exhausted", () => {
        expect(isRetired({kind: "expired", at: "x"})).toBe(true);
        expect(isRetired({kind: "exhausted"})).toBe(true);
        for (const k of [{kind: "ok"}, {kind: "removed"}, {kind: "paused"}, {kind: "not_found"}, {
            kind: "not_yet",
            activateAt: "x"
        }] as const) {
            expect(isRetired(k)).toBe(false);
        }
    });
});
