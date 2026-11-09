import {SCHEMA_VERSION} from "../schema";

const steps: Record<number, (r: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrateRecord(raw: unknown): unknown {
    if (!raw || typeof raw !== "object") throw new Error("Record is not an object");
    let r = raw as Record<string, unknown>;
    let v = typeof r.v === "number" ? r.v : 1;
    if (v > SCHEMA_VERSION) throw new Error(`Record schema v${v} is newer than this build (v${SCHEMA_VERSION})`);
    while (v < SCHEMA_VERSION) {
        const step = steps[v];
        if (!step) throw new Error(`No migration from schema v${v}`);
        r = step(r);
        v = Number(r.v);
    }
    return r;
}
