import {z} from "zod";
import {ok, readJson} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {importLibrary} from "@/lib/redis/maintenance";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
    data: z.unknown(),
    dryRun: z.boolean().default(true),
    policy: z.enum(["skip", "overwrite", "duplicate"]).default("skip"),
});

export const POST = ownerRoute(async (req) => {
    const b = body.parse(await readJson(req, 8 * 1024 * 1024));
    return ok(await importLibrary(b.data, {dryRun: b.dryRun, policy: b.policy}));
});
