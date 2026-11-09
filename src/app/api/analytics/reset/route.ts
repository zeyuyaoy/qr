import {z} from "zod";
import {ok, readJson} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {resetAnalytics} from "@/lib/redis/repo";
import {idSchema} from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({id: idSchema.optional(), confirm: z.literal("reset")});

export const POST = ownerRoute(async (req) => ok({deleted: await resetAnalytics(body.parse(await readJson(req)).id)}));
