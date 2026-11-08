import { z } from "zod";
import { ok, readJson } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { deleteFolder, saveFolder } from "@/lib/redis/repo";
import { hex, idSchema } from "@/lib/schema";

export const runtime = "nodejs";

const patch = z.object({ name: z.string().trim().min(1).max(60), color: hex.nullable().optional() });

export const PATCH = ownerRoute<{ id: string }>(async (req, { params }) =>
  ok(await saveFolder({ id: idSchema.parse(params.id), ...patch.parse(await readJson(req)) })),
);
/** Deleting a folder un-files its codes; it never deletes codes. */
export const DELETE = ownerRoute<{ id: string }>(async (_req, { params }) => ok({ unfiled: await deleteFolder(idSchema.parse(params.id)) }));
