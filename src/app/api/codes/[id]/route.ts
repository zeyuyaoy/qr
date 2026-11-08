import { ApiError, ok, readJson } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { getCode, purgeCode, scanCount, toView, updateCode } from "@/lib/redis/repo";
import { idSchema, updateInput } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { id: string };
const id = (p: P) => idSchema.parse(p.id);

export const GET = ownerRoute<P>(async (_req, { params }) => {
  const rec = await getCode(id(params));
  if (!rec) throw new ApiError("NOT_FOUND", "Code not found");
  return ok(toView(rec, await scanCount(rec.id)));
});

export const PATCH = ownerRoute<P>(async (req, { params }) => {
  const patch = updateInput.parse(await readJson(req));
  const rec = await updateCode(id(params), patch);
  return ok(toView(rec, await scanCount(rec.id)));
});

/** DELETE moves to trash; `?permanent=1` removes it for good (only allowed from the trash). */
export const DELETE = ownerRoute<P>(async (req, { params }) => {
  const cid = id(params);
  const permanent = new URL(req.url).searchParams.get("permanent") === "1";
  const cur = await getCode(cid);
  if (!cur) throw new ApiError("NOT_FOUND", "Code not found");
  if (permanent) {
    if (cur.status !== "trashed") throw new ApiError("BAD_REQUEST", "Move the code to the trash before deleting it permanently");
    await purgeCode(cid);
    return ok({ id: cid, purged: true });
  }
  const rec = await updateCode(cid, { status: "trashed", pinned: false });
  return ok(toView(rec, await scanCount(cid)));
});
