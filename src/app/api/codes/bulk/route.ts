import {z} from "zod";
import {ok, readJson, toErrorResponse} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {createCode, toView} from "@/lib/redis/repo";
import {type ApiResult, createInput, type QrView} from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({items: z.array(z.unknown()).min(1).max(200)});

export const POST = ownerRoute(async (req) => {
    const {items} = body.parse(await readJson(req, 2 * 1024 * 1024));
    const results: ApiResult<QrView>[] = [];
    for (const raw of items) {
        const parsed = createInput.safeParse(raw);
        if (!parsed.success) {
            results.push({
                ok: false,
                error: {code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid item"}
            });
            continue;
        }
        try {
            results.push({ok: true, data: toView(await createCode(parsed.data), 0)});
        } catch (e) {
            const res = toErrorResponse(e);
            results.push((await res.json()) as ApiResult<QrView>);
        }
    }
    return ok({results, created: results.filter((r) => r.ok).length});
});
