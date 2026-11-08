import { ok, readJson } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { getSettings, saveSettings } from "@/lib/redis/repo";
import { settingsSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async () => ok(await getSettings()));
export const PUT = ownerRoute(async (req) => ok(await saveSettings(settingsSchema.parse(await readJson(req)))));
