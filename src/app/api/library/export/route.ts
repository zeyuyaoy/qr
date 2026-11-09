import {toCsv} from "@/lib/analytics-report";
import {ownerRoute} from "@/lib/guard";
import {LIBRARY_FORMAT} from "@/lib/redis/maintenance";
import {getAsset, listCodes, listFolders, listTemplates} from "@/lib/redis/repo";
import {env} from "@/lib/env";
import {shortUrl} from "@/lib/qr/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async (req) => {
    const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";
    const {records, scans} = await listCodes();
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "csv") {
        const rows: (string | number)[][] = [["id", "name", "type", "mode", "status", "slug", "short_url", "destination_or_payload", "tags", "folder", "scans", "created", "updated"]];
        for (const r of records) {
            rows.push([r.id, r.name, r.type, r.mode, r.status, r.slug ?? "", r.slug ? shortUrl(env.appUrl(), r.slug) : "", r.type === "wifi" || r.type === "vcard" ? "(sensitive — see JSON export)" : r.payload, r.tags.join("|"), r.folder ?? "", scans.get(r.id) ?? 0, r.createdAt, r.updatedAt]);
        }
        return new Response(toCsv(rows), {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="qr-library-${stamp}.csv"`,
                "Cache-Control": "no-store"
            }
        });
    }
    const [folders, templates] = await Promise.all([listFolders(), listTemplates()]);
    const assetIds = [...new Set([...records, ...templates].flatMap(({style}) => style.logo.assetId ?? []))];
    const assets: Record<string, string> = {};
    for (let i = 0; i < assetIds.length; i += 32) {
        const batch = assetIds.slice(i, i + 32);
        const pairs = await Promise.all(batch.map(async (id) => [id, await getAsset(id)] as const));
        for (const [id, url] of pairs) if (url) assets[id] = url;
    }
    const body = {
        format: LIBRARY_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        codes: records.map(({password, ...r}) => ({...r, password: null, hadPassword: Boolean(password)})),
        folders: folders.map(({count: _count, ...folder}) => folder),
        templates,
        assets,
    };
    return new Response(JSON.stringify(body, null, 2), {
        headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="qr-library-${stamp}.json"`,
            "Cache-Control": "no-store"
        }
    });
});
