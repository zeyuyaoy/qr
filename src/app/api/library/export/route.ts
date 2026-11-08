import { toCsv } from "@/lib/analytics-report";
import { ownerRoute } from "@/lib/guard";
import { LIBRARY_FORMAT } from "@/lib/redis/maintenance";
import { getAsset, listCodes, listFolders, listTemplates } from "@/lib/redis/repo";
import { env } from "@/lib/env";
import { shortUrl } from "@/lib/qr/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plain (decrypted) export of the owner's own data. Password hashes are never exported. */
export const GET = ownerRoute(async (req) => {
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const { records, scans } = await listCodes();
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const rows: (string | number)[][] = [["id", "name", "type", "mode", "status", "slug", "short_url", "destination_or_payload", "tags", "folder", "scans", "created", "updated"]];
    for (const r of records) {
      rows.push([r.id, r.name, r.type, r.mode, r.status, r.slug ?? "", r.slug ? shortUrl(env.appUrl(), r.slug) : "", r.type === "wifi" || r.type === "vcard" ? "(sensitive — see JSON export)" : r.payload, r.tags.join("|"), r.folder ?? "", scans.get(r.id) ?? 0, r.createdAt, r.updatedAt]);
    }
    return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="qr-library-${stamp}.csv"`, "Cache-Control": "no-store" } });
  }
  const templates = await listTemplates();
  const assetIds = new Set([...records.map((r) => r.style.logo.assetId), ...templates.map((t) => t.style.logo.assetId)].filter((id): id is string => Boolean(id)));
  const assets: Record<string, string> = {};
  for (const id of assetIds) { const data = await getAsset(id); if (data) assets[id] = data; }
  const body = {
    format: LIBRARY_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    codes: records.map(({ password, ...r }) => ({ ...r, password: null, hadPassword: Boolean(password) })),
    folders: await listFolders().then((f) => f.map(({ count, ...x }) => (void count, x))),
    templates,
    assets,
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="qr-library-${stamp}.json"`, "Cache-Control": "no-store" } });
});
