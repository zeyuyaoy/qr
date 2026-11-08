import { z } from "zod";
import { ApiError, ok, readJson } from "@/lib/api";
import { BackupFormatError } from "@/lib/backup/envelope";
import { restoreFrom } from "@/lib/backup/run";
import { parseKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ownerRoute } from "@/lib/guard";
import { hit } from "@/lib/redis/repo";

export const runtime = "nodejs";
export const maxDuration = 120;

const body = z.object({
  source: z.union([z.object({ github: z.string().max(120) }), z.object({ text: z.string().max(40 * 1024 * 1024) })]),
  dryRun: z.boolean().default(true),
  mode: z.enum(["merge", "replace"]).default("merge"),
  prefer: z.enum(["newer", "snapshot", "existing"]).default("newer"),
  /** Replace mode deletes data not in the snapshot; require an explicit typed confirmation. */
  confirm: z.string().optional(),
});

export const POST = ownerRoute(async (req) => {
  const b = body.parse(await readJson(req, 40 * 1024 * 1024));
  try {
    parseKey(env.backupKey(), "BACKUP_ENCRYPTION_KEY");
  } catch (e) {
    throw new ApiError("NOT_CONFIGURED", e instanceof Error ? e.message : "BACKUP_ENCRYPTION_KEY is not configured");
  }
  if ((await hit("restore", 60)) > 6) throw new ApiError("RATE_LIMITED", "Too many restore attempts", undefined, { "Retry-After": "60" });
  if (!b.dryRun && b.mode === "replace" && b.confirm !== "replace") throw new ApiError("BAD_REQUEST", 'Type "replace" to confirm a replace-mode restore');
  try {
    return ok(await restoreFrom(b.source, { dryRun: b.dryRun, mode: b.mode, prefer: b.prefer }));
  } catch (e) {
    if (e instanceof BackupFormatError) throw new ApiError("BAD_REQUEST", e.message);
    throw e;
  }
});
