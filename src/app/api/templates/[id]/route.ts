import { z } from "zod";
import { ok, readJson } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { deleteTemplate, saveTemplate } from "@/lib/redis/repo";
import { idSchema, styleSchema } from "@/lib/schema";

export const runtime = "nodejs";

const patch = z.object({ name: z.string().trim().min(1).max(60), style: styleSchema });

export const PATCH = ownerRoute<{ id: string }>(async (req, { params }) =>
  ok(await saveTemplate({ id: idSchema.parse(params.id), ...patch.parse(await readJson(req)) })),
);
export const DELETE = ownerRoute<{ id: string }>(async (_req, { params }) => {
  await deleteTemplate(idSchema.parse(params.id));
  return ok({ deleted: true });
});
