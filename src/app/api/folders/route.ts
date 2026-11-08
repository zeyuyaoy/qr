import { z } from "zod";
import { ok, readJson } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { listFolders, saveFolder } from "@/lib/redis/repo";
import { hex } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const folderInput = z.object({ name: z.string().trim().min(1).max(60), color: hex.nullable().optional() });

export const GET = ownerRoute(async () => ok(await listFolders()));
export const POST = ownerRoute(async (req) => ok(await saveFolder(folderInput.parse(await readJson(req))), { status: 201 }));
