import { z } from "zod";
import { ok, readJson } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { getMeta, initMeta } from "@/lib/redis/repo";

export const runtime = "nodejs";

const body = z.object({ confirm: z.literal("start-empty") });

/** Explicitly mark the library as initialised (first run, or "start fresh" after accepting data loss). */
export const POST = ownerRoute(async (req) => {
  body.parse(await readJson(req));
  return ok(await initMeta().then(async (m) => m ?? (await getMeta())));
});
