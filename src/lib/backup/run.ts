import { env } from "../env";
import { withRedis } from "../redis/client";
import { K } from "../redis/keys";
import { getMeta } from "../redis/repo";
import { GithubError, deleteRemote, fetchRemote, listRemote, planPrune, putRemote, snapshotName, type RemoteSnapshot } from "./github";
import { collectSnapshot, contentHash, packSnapshot, restoreSnapshot, unpackSnapshot, type RestoreOptions } from "./snapshot";

export type BackupRun = {
  at: string;
  trigger: "cron" | "manual";
  outcome: "created" | "unchanged" | "failed" | "skipped";
  name?: string;
  records?: number;
  bytes?: number;
  pruned?: number;
  error?: string;
};
export type BackupStatus = { lastSuccessAt: string | null; lastAttemptAt: string | null; history: BackupRun[] };

export const STALE_AFTER_MS = 36 * 3600_000;
const HISTORY_MAX = 30;

export async function readStatus(): Promise<BackupStatus> {
  try {
    const raw = await withRedis((r) => r.get(K.backupStatus()));
    if (raw) return JSON.parse(raw) as BackupStatus;
  } catch {}
  return { lastSuccessAt: null, lastAttemptAt: null, history: [] };
}
async function writeStatus(run: BackupRun) {
  try {
    const s = await readStatus();
    const next: BackupStatus = {
      lastAttemptAt: run.at,
      lastSuccessAt: run.outcome === "created" || run.outcome === "unchanged" ? run.at : s.lastSuccessAt,
      history: [run, ...s.history.filter((h) => h.at !== run.at || h.trigger !== run.trigger)].slice(0, HISTORY_MAX),
    };
    await withRedis((r) => r.set(K.backupStatus(), JSON.stringify(next)));
  } catch {
    // Status history is advisory; the GitHub listing remains the source of truth.
  }
}

export const backupConfigured = () => Boolean(env.github() && env.backupKey());

export type Freshness = { state: "ok" | "stale" | "never" | "unconfigured"; lastSuccessAt: string | null; ageHours: number | null };
export function freshness(lastSuccessAt: string | null, configured = backupConfigured()): Freshness {
  if (!configured) return { state: "unconfigured", lastSuccessAt, ageHours: null };
  if (!lastSuccessAt) return { state: "never", lastSuccessAt, ageHours: null };
  const age = Date.now() - Date.parse(lastSuccessAt);
  return { state: age > STALE_AFTER_MS ? "stale" : "ok", lastSuccessAt, ageHours: Math.round(age / 360_000) / 10 };
}

/** Run one backup. Never throws: every outcome (including failure) is recorded and returned. */
export async function runBackup(trigger: BackupRun["trigger"]): Promise<BackupRun> {
  const at = new Date().toISOString();
  const finish = async (run: Omit<BackupRun, "at" | "trigger">): Promise<BackupRun> => {
    const full = { at, trigger, ...run };
    await writeStatus(full);
    return full;
  };
  if (!backupConfigured()) return finish({ outcome: "failed", error: "Backup is not configured (GitHub repo/token and BACKUP_ENCRYPTION_KEY)" });

  let locked = false;
  try {
    locked = (await withRedis((r) => r.set(K.backupLock(), at, { condition: "NX", expiration: { type: "EX", value: 300 } }))) === "OK";
    if (!locked) return { at, trigger, outcome: "skipped", error: "Another backup is already running" };
    await writeStatus({ at, trigger, outcome: "failed", error: "Backup has not completed. If it was interrupted or timed out, retry after the backup lock expires (5 minutes)." });
    if (!(await getMeta())) {
      // Protects good history: an empty/uninitialised Redis must never become "the latest snapshot".
      return finish({ outcome: "skipped", error: "Redis is not initialised (possible data loss). Backup skipped to protect previous snapshots — open the recovery screen." });
    }
    const { snapshot, skipped } = await collectSnapshot();
    if (skipped.length) return finish({ outcome: "failed", error: `${skipped.length} unreadable record(s); incomplete backup refused. Repair or recover the library first.` });
    const { text } = packSnapshot(snapshot, env.backupKey());
    const hash = contentHash(snapshot);
    const remote = await listRemote();
    let outcome: BackupRun["outcome"] = "unchanged";
    let name = remote[0]?.name;
    let verifiedUnchanged = false;
    if (remote[0]?.hash8 === hash.slice(0, 8)) {
      try {
        const prior = unpackSnapshot(await fetchRemote(remote[0].name), env.backupKey()).snapshot;
        verifiedUnchanged = contentHash(prior) === hash;
      } catch { /* A corrupt snapshot or rotated key requires a fresh recoverable snapshot. */ }
    }
    if (!verifiedUnchanged) {
      name = snapshotName(snapshot.createdAt, hash);
      await putRemote(name, text);
      if (await fetchRemote(name) !== text) throw new GithubError("Uploaded snapshot verification failed");
      outcome = "created";
    }
    let pruned = 0;
    if (outcome === "created") {
      const list: RemoteSnapshot[] = [{ name: name!, path: `snapshots/${name}`, sha: "", size: text.length, createdAt: snapshot.createdAt.replace(/\.\d+Z$/, "Z"), hash8: hash.slice(0, 8) }, ...remote];
      for (const old of planPrune(list)) {
        if (!old.sha) continue;
        try { await deleteRemote(old); pruned++; } catch { break; }
      }
    }
    return finish({ outcome, name, records: snapshot.codes.length, bytes: text.length, pruned, ...(skipped.length ? { error: `${skipped.length} unreadable record(s) were not included` } : {}) });
  } catch (e) {
    const msg = e instanceof GithubError ? e.message + (e.retryAfter ? ` (retry in ${e.retryAfter}s)` : "") : e instanceof Error ? e.message : "Backup failed";
    return finish({ outcome: "failed", error: msg.slice(0, 300) });
  } finally {
    if (locked) await withRedis((r) => r.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0", { keys: [K.backupLock()], arguments: [at] })).catch(() => undefined);
  }
}

export async function listSnapshots() {
  return listRemote();
}

/** Decrypt + validate a snapshot from GitHub or an uploaded file, then dry-run or apply it. */
export async function restoreFrom(source: { github: string } | { text: string }, opts: RestoreOptions) {
  const text = "github" in source ? await fetchRemote(source.github) : source.text;
  const { snapshot, envelope } = unpackSnapshot(text, env.backupKey());
  const report = await restoreSnapshot(snapshot, opts);
  return { report, envelope: { createdAt: envelope.createdAt, recordCount: envelope.recordCount, schemaVersion: envelope.schemaVersion } };
}
