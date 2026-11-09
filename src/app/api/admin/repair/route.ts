import {z} from "zod";
import {ok, readJson} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {repairIndexes} from "@/lib/redis/maintenance";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({apply: z.boolean().default(false)});

export const POST = ownerRoute(async (req) => ok(await repairIndexes(body.parse(await readJson(req)).apply)));
