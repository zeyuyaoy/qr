import { ok, readJson } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { queryLibrary, type LibraryQuery } from "@/lib/library-query";
import { createCode, listCodes, toView } from "@/lib/redis/repo";
import { createInput } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async (req) => {
  const sp = new URL(req.url).searchParams;
  const { records, unreadable, scans } = await listCodes();
  const now = Date.now();
  const views = records.map((r) => toView(r, scans.get(r.id) ?? 0, now));
  const q: LibraryQuery = {
    q: sp.get("q") ?? undefined,
    status: (sp.get("status") as LibraryQuery["status"]) ?? undefined,
    type: sp.get("type") ?? undefined,
    mode: (sp.get("mode") as LibraryQuery["mode"]) ?? undefined,
    folder: sp.get("folder") ?? undefined,
    tag: sp.get("tag") ?? undefined,
    favorite: sp.get("favorite") === "1" || undefined,
    state: (sp.get("state") as LibraryQuery["state"]) ?? undefined,
    sort: (sp.get("sort") as LibraryQuery["sort"]) ?? undefined,
    dir: (sp.get("dir") as LibraryQuery["dir"]) ?? undefined,
  };
  const filtered = queryLibrary(views, q);
  const limit = Math.min(Number(sp.get("limit") ?? 1000) || 1000, 2000);
  const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);
  return ok({ items: filtered.slice(offset, offset + limit), total: filtered.length, unreadable });
});

export const POST = ownerRoute(async (req) => {
  const input = createInput.parse(await readJson(req));
  const rec = await createCode(input);
  return ok(toView(rec, 0), { status: 201 });
});
