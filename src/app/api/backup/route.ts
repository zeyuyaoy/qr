import { ApiError, ok } from "@/lib/api";
import { backupConfigured, freshness, listSnapshots, readStatus, runBackup } from "@/lib/backup/run";
import { ownerRoute } from "@/lib/guard";
import { hit } from "@/lib/redis/repo";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async () => {
  const status = await readStatus();
  let snapshots: Awaited<ReturnType<typeof listSnapshots>> = [];
  let listError: string | null = null;
  if (backupConfigured()) {
    try { snapshots = await listSnapshots(); } catch (e) { listError = e instanceof Error ? e.message : "Could not list snapshots"; }
  }
  const lastRemote = snapshots[0]?.createdAt ?? null;
  const last = [status.lastSuccessAt, lastRemote].filter(Boolean).sort().pop() ?? null;
  return ok({ configured: backupConfigured(), freshness: freshness(last), status, snapshots: snapshots.slice(0, 40), listError });
});

export const POST = ownerRoute(async () => {
  if ((await hit("backup-now", 60)) > 3) throw new ApiError("RATE_LIMITED", "Backups can be started at most 3 times a minute", undefined, { "Retry-After": "60" });
  return ok(await runBackup("manual"));
});
