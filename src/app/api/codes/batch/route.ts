import { z } from "zod";
import { ok, readJson } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { getCode, listTemplates, purgeCode, RepoError, updateCode } from "@/lib/redis/repo";
import { idSchema, tagSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
  ids: z.array(idSchema).min(1).max(200),
  action: z.enum(["archive", "restore", "trash", "purge", "favorite", "unfavorite", "pin", "unpin", "enable", "disable", "tag-add", "tag-remove", "move-folder", "apply-template"]),
  value: z.string().nullable().optional(),
});

export const POST = ownerRoute(async (req) => {
  const { ids, action, value } = body.parse(await readJson(req));
  const tpl = action === "apply-template" ? (await listTemplates()).find((t) => t.id === value) : undefined;
  if (action === "apply-template" && !tpl) throw new RepoError("NOT_FOUND", "Template not found");
  const tag = action.startsWith("tag-") ? tagSchema.parse(value) : null;
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      if (action === "purge") {
        const t = await getCode(id);
        if (t && t.status !== "trashed") throw new RepoError("BAD_REQUEST", "Move to the trash before deleting permanently");
        results.push({ id, ok: await purgeCode(id) });
        continue;
      }
      const cur = await getCode(id);
      if (!cur) throw new RepoError("NOT_FOUND", "Not found");
      const patch =
        action === "archive" ? { status: "archived" as const }
        : action === "restore" ? { status: "active" as const }
        : action === "trash" ? { status: "trashed" as const, pinned: false }
        : action === "favorite" ? { favorite: true }
        : action === "unfavorite" ? { favorite: false }
        : action === "pin" ? { pinned: true }
        : action === "unpin" ? { pinned: false }
        : action === "enable" ? { enabled: true }
        : action === "disable" ? { enabled: false }
        : action === "tag-add" ? { tags: [...new Set([...cur.tags, tag!])] }
        : action === "tag-remove" ? { tags: cur.tags.filter((t) => t !== tag) }
        : action === "move-folder" ? { folder: value ? value : null }
        : { style: { ...tpl!.style, logo: tpl!.style.logo, preset: tpl!.style.preset } };
      await updateCode(id, patch);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : "Failed" });
    }
  }
  return ok({ results, succeeded: results.filter((r) => r.ok).length });
});
