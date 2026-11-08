import { ApiError } from "@/lib/api";
import { collectSnapshot, packSnapshot } from "@/lib/backup/snapshot";
import { env } from "@/lib/env";
import { ownerRoute } from "@/lib/guard";
import { getMeta } from "@/lib/redis/repo";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Encrypted export only — a plaintext full-database dump is deliberately not offered. */
export const GET = ownerRoute(async () => {
  if (!env.backupKey()) throw new ApiError("NOT_CONFIGURED", "BACKUP_ENCRYPTION_KEY is required to create encrypted exports");
  if (!(await getMeta())) throw new ApiError("RECOVERY_REQUIRED", "Library is not initialised; nothing to export");
  const { snapshot } = await collectSnapshot();
  const { text } = packSnapshot(snapshot, env.backupKey());
  return new Response(text, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="qr-studio-${snapshot.createdAt.slice(0, 10)}.qrbackup.json"`,
      "Cache-Control": "no-store",
    },
  });
});
