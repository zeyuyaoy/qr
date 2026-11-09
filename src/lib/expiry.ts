import type {LinkState, QrRecord} from "./schema";

type Timing = Pick<QrRecord, "status" | "enabled" | "schedule" | "createdAt" | "scanLimit" | "mode">;

export function effectiveExpiry(r: Pick<QrRecord, "schedule" | "createdAt">): number | null {
    const {activateAt, expiresAt, expireAfterSeconds} = r.schedule;
    const candidates: number[] = [];
    if (expiresAt) candidates.push(Date.parse(expiresAt));
    if (expireAfterSeconds) {
        const anchor = Date.parse(activateAt ?? r.createdAt);
        candidates.push(anchor + expireAfterSeconds * 1000);
    }
    return candidates.length ? Math.min(...candidates) : null;
}

export function evaluateLink(r: Timing, now: number, scans: number): LinkState {
    if (r.status === "trashed") return {kind: "removed"};
    if (r.status === "archived" || !r.enabled) return {kind: "paused"};
    const {activateAt} = r.schedule;
    if (activateAt && Date.parse(activateAt) > now) return {kind: "not_yet", activateAt};
    const exp = effectiveExpiry(r);
    if (exp !== null && exp <= now) return {kind: "expired", at: new Date(exp).toISOString()};
    if (r.scanLimit !== null && scans >= r.scanLimit) return {kind: "exhausted"};
    return {kind: "ok"};
}

export const isRetired = (s: LinkState) => s.kind === "expired" || s.kind === "exhausted";
