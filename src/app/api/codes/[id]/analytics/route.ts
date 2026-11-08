import { ok } from "@/lib/api";
import { buildReport } from "@/lib/analytics-report";
import { ownerRoute } from "@/lib/guard";
import { idSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute<{ id: string }>(async (req, { params }) => {
  const sp = new URL(req.url).searchParams;
  const days = Math.min(Math.max(Number(sp.get("days") ?? 30) || 30, 1), 365);
  const to = new Date();
  return ok(await buildReport(new Date(to.getTime() - (days - 1) * 86_400_000), to, idSchema.parse(params.id)));
});
