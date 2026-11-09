import {ApiError, ok} from "@/lib/api";
import {buildReport, reportCsv} from "@/lib/analytics-report";
import {ownerRoute} from "@/lib/guard";
import {idSchema} from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseDay = (s: string | null, fallback: Date) => {
    if (!s) return fallback;
    const d = new Date(`${s}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime())) throw new ApiError("BAD_REQUEST", "Dates must be YYYY-MM-DD");
    return d;
};

export const GET = ownerRoute(async (req) => {
    const sp = new URL(req.url).searchParams;
    const to = parseDay(sp.get("to"), new Date());
    const from = parseDay(sp.get("from"), new Date(to.getTime() - 29 * 86_400_000));
    if (from > to) throw new ApiError("BAD_REQUEST", "`from` must not be after `to`");
    const id = sp.get("id") ? idSchema.parse(sp.get("id")) : undefined;
    const report = await buildReport(from, to, id);
    if (sp.get("format") === "csv") {
        return new Response(reportCsv(report), {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="qr-analytics-${report.range.from}_${report.range.to}.csv"`,
                "Cache-Control": "no-store"
            },
        });
    }
    return ok(report);
});
