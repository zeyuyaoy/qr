import {ApiError, ok} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {getAsset} from "@/lib/redis/repo";

export const runtime = "nodejs";

export const GET = ownerRoute<{ id: string }>(async (_req, {params}) => {
    const dataUrl = await getAsset(params.id);
    if (!dataUrl) throw new ApiError("NOT_FOUND", "Asset not found");
    return ok({dataUrl}, {headers: {"Cache-Control": "private, max-age=31536000, immutable"}});
});
