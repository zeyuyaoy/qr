import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api";
import { runBackup } from "@/lib/backup/run";
import { requireCron } from "@/lib/guard";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  try {
    requireCron(req);
    const run = await runBackup("cron");
    // Surface failures as 500 so they show up in Vercel's cron logs; never echo internals.
    return NextResponse.json({ ok: run.outcome !== "failed", outcome: run.outcome, name: run.name, records: run.records, error: run.error }, { status: run.outcome === "failed" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
