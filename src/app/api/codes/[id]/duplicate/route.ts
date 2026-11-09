import {ApiError, ok} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {createCode, getCode, toView} from "@/lib/redis/repo";
import {idSchema} from "@/lib/schema";

export const runtime = "nodejs";

export const POST = ownerRoute<{ id: string }>(async (_req, {params}) => {
    const src = await getCode(idSchema.parse(params.id));
    if (!src) throw new ApiError("NOT_FOUND", "Code not found");
    const copy = await createCode({
        name: `${src.name} (copy)`.slice(0, 120),
        description: src.description,
        type: src.type,
        mode: src.mode,
        fields: src.fields,
        payload: src.payload,
        style: src.style,
        tags: src.tags,
        folder: src.folder,
        enabled: src.enabled && !src.password,
        schedule: src.schedule,
        scanLimit: src.scanLimit,
        afterExpiry: src.afterExpiry,
        analytics: src.analytics,
    });
    return ok(toView(copy, 0), {status: 201});
});
