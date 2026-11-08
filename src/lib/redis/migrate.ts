import { SCHEMA_VERSION } from "../schema";

/**
 * Forward-only record migrations. Each step upgrades `v` by one. Add a step here whenever
 * SCHEMA_VERSION is bumped; records newer than this build are rejected rather than guessed at.
 */
const steps: Record<number, (r: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (r) => ({ ...r, v: 2, newField: default })   ← example for the future
};

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
