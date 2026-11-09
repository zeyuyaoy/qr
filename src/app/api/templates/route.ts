import {z} from "zod";
import {ok, readJson} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {listTemplates, saveTemplate} from "@/lib/redis/repo";
import {styleSchema} from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const templateInput = z.object({name: z.string().trim().min(1).max(60), style: styleSchema});

export const GET = ownerRoute(async () => ok(await listTemplates()));
export const POST = ownerRoute(async (req) => ok(await saveTemplate(templateInput.parse(await readJson(req))), {status: 201}));
