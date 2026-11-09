import {z} from "zod";
import {ok, readJson} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {putAsset} from "@/lib/redis/repo";

export const runtime = "nodejs";

const body = z.object({dataUrl: z.string().max(20_000)});

export const POST = ownerRoute(async (req) => ok({id: await putAsset(body.parse(await readJson(req, 32 * 1024)).dataUrl)}, {status: 201}));
