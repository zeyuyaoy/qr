import { z } from "zod";
import { LIBRARY_FORMAT } from "../library-format";
import { newId, newSlug } from "../ids";
import { seal } from "../seal";
import { SENSITIVE_TYPES, folderSchema, qrRecordSchema, settingsSchema, templateSchema, type Folder, type QrRecord, type Template } from "../schema";
import { withRedis } from "./client";
import { K, assertOwnKey, prefix } from "./keys";
import { MAX_CODES, RepoError, assertWritable, assetHash, parseStoredLoose, purgeCode, putRaw, storedSchema, validateImported } from "./repo";
import { migrateRecord } from "./migrate";

export type StoredRecord = QrRecord & { sealed?: string };

/** Read every stored record WITHOUT decrypting sealed fields (backup/restore never need the data key). */
export async function readAllStored(): Promise<{ records: Map<string, { rec: StoredRecord; raw: string }>; corrupt: string[] }> {
  const keys = await scanKeys(`${prefix()}code:*`, MAX_CODES + 1);
  if (keys.length > MAX_CODES) throw new RepoError("CONFLICT", "Library exceeds the supported backup size; export or reduce it before continuing");
  const ids = keys.map((key) => key.slice(`${prefix()}code:`.length));
  const records = new Map<string, { rec: StoredRecord; raw: string }>();
  const corrupt: string[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    const raws = await withRedis((r) => r.mGet(part.map(K.code)));
    part.forEach((id, j) => {
      const raw = raws[j];
      if (!raw) return;
      try {
        records.set(id, { rec: parseStoredLoose(raw) as StoredRecord, raw });
      } catch {
        corrupt.push(id);
      }
    });
  }
  return { records, corrupt };
}

export type UpsertResult = "created" | "updated" | "skipped" | "slug_conflict";

/** Write an already-validated stored record (possibly sealed). Used by import and restore. */
export async function upsertStored(rec: StoredRecord, policy: "skip" | "overwrite"): Promise<UpsertResult> {
  const curRaw = await withRedis((r) => r.get(K.code(rec.id)));
  const toJson = (x: StoredRecord) => JSON.stringify(x);
  if (!curRaw) {
    const [st] = await putRaw("create", rec, 0, toJson(rec));
    return st === "OK" ? "created" : st === "SLUG" ? "slug_conflict" : "skipped";
  }
  if (policy === "skip") return "skipped";
  const cur = parseStoredLoose(curRaw);
  const next = { ...rec, rev: Math.max(cur.rev, rec.rev) + 1 };
  const [st] = await putRaw("update", next, cur.rev, toJson(next));
  return st === "OK" ? "updated" : st === "SLUG" ? "slug_conflict" : "skipped";
}

export async function upsertFolder(f: Folder) {
  await withRedis((r) => r.multi().set(K.folder(f.id), JSON.stringify(f)).sAdd(K.indexFolders(), f.id).exec());
}
export async function upsertTemplate(t: Template) {
  await withRedis((r) => r.multi().set(K.template(t.id), JSON.stringify(t)).sAdd(K.indexTemplates(), t.id).exec());
}

// -------------------------------------------------------------- index verification / repair
export type IndexReport = {
  codes: number;
  corrupt: string[];
  missingFromIndex: string[];
  staleIndexEntries: string[];
  slugFixed: number;
  slugConflicts: { slug: string; keptId: string; droppedId: string }[];
  folderFixed: number;
  tagFixed: number;
  orphanAssets: number;
  applied: boolean;
};

async function scanKeys(match: string, max = 50_000): Promise<string[]> {
  const out: string[] = [];
  await withRedis(async (r) => {
    let cursor = "0";
    do {
      const res = await r.scan(cursor, { MATCH: match, COUNT: 500 });
      cursor = res.cursor;
      for (const k of res.keys) out.push(assertOwnKey(k));
    } while (cursor !== "0" && out.length < max);
  });
  return out;
}
export const scanOwn = scanKeys;

/**
 * Rebuild every derived structure (code index, slug map, folder & tag sets) from the primary
 * `code:*` records. Dry-run by default. Bounded: at most MAX_CODES records and 50k keys scanned.
 */
export async function repairIndexes(apply: boolean): Promise<IndexReport> {
  if (apply) await assertWritable();
  const codeKeys = await scanKeys(`${prefix()}code:*`);
  const byId = new Map<string, StoredRecord>();
  const corrupt: string[] = [];
  for (let i = 0; i < codeKeys.length; i += 400) {
    const part = codeKeys.slice(i, i + 400);
    const raws = await withRedis((r) => r.mGet(part));
    part.forEach((k, j) => {
      const id = k.slice(prefix().length + "code:".length);
      try {
        if (raws[j]) byId.set(id, parseStoredLoose(raws[j]!) as StoredRecord);
      } catch {
        corrupt.push(id);
      }
    });
  }

  // desired state
  const wantSlug = new Map<string, string>();
  const slugConflicts: IndexReport["slugConflicts"] = [];
  const sorted = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const rec of sorted) {
    if (!rec.slug) continue;
    const holder = wantSlug.get(rec.slug);
    if (holder) slugConflicts.push({ slug: rec.slug, keptId: holder, droppedId: rec.id });
    else wantSlug.set(rec.slug, rec.id);
  }
  const wantFolder = new Map<string, Set<string>>();
  const wantTag = new Map<string, Set<string>>();
  for (const rec of byId.values()) {
    if (rec.folder) (wantFolder.get(rec.folder) ?? wantFolder.set(rec.folder, new Set()).get(rec.folder)!).add(rec.id);
    for (const t of rec.tags) (wantTag.get(t) ?? wantTag.set(t, new Set()).get(t)!).add(rec.id);
  }

  const indexed = await withRedis((r) => r.zRange(K.indexCodes(), 0, -1));
  const missingFromIndex = [...byId.keys()].filter((id) => !indexed.includes(id));
  const staleIndexEntries = indexed.filter((id) => !byId.has(id));

  // slug map
  const slugKeys = await scanKeys(`${prefix()}slug:*`);
  const slugVals = slugKeys.length ? await withRedis((r) => r.mGet(slugKeys)) : [];
  let slugFixed = 0;
  const staleSlugKeys = slugKeys.filter((k, i) => wantSlug.get(k.slice(prefix().length + 5)) !== slugVals[i]);
  const missingSlugs = [...wantSlug].filter(([s, id]) => !slugKeys.includes(K.slug(s)) || slugVals[slugKeys.indexOf(K.slug(s))] !== id);
  slugFixed = staleSlugKeys.length + missingSlugs.length;

  // folder / tag sets
  let folderFixed = 0;
  let tagFixed = 0;
  const folderKeys = await scanKeys(`${prefix()}index:folder:*`);
  const tagKeys = await scanKeys(`${prefix()}index:tag:*`);
  const diffSet = async (key: string, want: Set<string>) => {
    const have = new Set(await withRedis((r) => r.sMembers(key)));
    const add = [...want].filter((x) => !have.has(x));
    const rem = [...have].filter((x) => !want.has(x));
    return { add, rem };
  };
  const setOps: { key: string; add: string[]; rem: string[] }[] = [];
  for (const [fid, ids] of wantFolder) {
    const d = await diffSet(K.indexFolder(fid), ids);
    if (d.add.length || d.rem.length) { folderFixed++; setOps.push({ key: K.indexFolder(fid), ...d }); }
  }
  for (const k of folderKeys) {
    const fid = k.slice(`${prefix()}index:folder:`.length);
    if (!wantFolder.has(fid)) {
      const d = await diffSet(k, new Set());
      if (d.rem.length) { folderFixed++; setOps.push({ key: k, add: [], rem: d.rem }); }
    }
  }
  for (const [tag, ids] of wantTag) {
    const d = await diffSet(K.indexTag(tag), ids);
    if (d.add.length || d.rem.length) { tagFixed++; setOps.push({ key: K.indexTag(tag), ...d }); }
  }
  for (const k of tagKeys) {
    const tag = k.slice(`${prefix()}index:tag:`.length);
    if (!wantTag.has(tag)) {
      const d = await diffSet(k, new Set());
      if (d.rem.length) { tagFixed++; setOps.push({ key: k, add: [], rem: d.rem }); }
    }
  }

  // assets not referenced anywhere
  const assetKeys = await scanKeys(`${prefix()}asset:*`);
  const used = new Set<string>();
  for (const rec of byId.values()) if (rec.style.logo.assetId) used.add(rec.style.logo.assetId);
  const tplIds = await withRedis((r) => r.sMembers(K.indexTemplates()));
  if (tplIds.length) {
    for (const raw of await withRedis((r) => r.mGet(tplIds.map(K.template)))) {
      if (raw) { const t = templateSchema.safeParse(JSON.parse(raw)); if (t.success && t.data.style.logo.assetId) used.add(t.data.style.logo.assetId); }
    }
  }
  const sRaw = await withRedis((r) => r.get(K.settings()));
  if (sRaw) { const s = settingsSchema.safeParse(JSON.parse(sRaw)); if (s.success && s.data.defaultStyle.logo.assetId) used.add(s.data.defaultStyle.logo.assetId); }
  const orphanAssets = assetKeys.filter((k) => !used.has(k.slice(`${prefix()}asset:`.length)));

  if (apply) {
    await withRedis(async (r) => {
      const m = r.multi();
      for (const id of staleIndexEntries) m.zRem(K.indexCodes(), id);
      for (const id of missingFromIndex) m.zAdd(K.indexCodes(), { score: Date.parse(byId.get(id)!.createdAt), value: id });
      for (const k of staleSlugKeys) m.del(assertOwnKey(k));
      for (const [s, id] of wantSlug) m.set(K.slug(s), id);
      for (const op of setOps) {
        if (op.add.length) m.sAdd(assertOwnKey(op.key), op.add);
        if (op.rem.length) m.sRem(assertOwnKey(op.key), op.rem);
      }
      m.del(K.indexTags());
      if (wantTag.size) m.sAdd(K.indexTags(), [...wantTag.keys()]);
      for (const k of orphanAssets) m.del(assertOwnKey(k));
      await m.exec();
    });
  }
  return {
    codes: byId.size,
    corrupt,
    missingFromIndex,
    staleIndexEntries,
    slugFixed,
    slugConflicts,
    folderFixed,
    tagFixed,
    orphanAssets: orphanAssets.length,
    applied: apply,
  };
}

// -------------------------------------------------------------- import file format
export { LIBRARY_FORMAT };
export const libraryFileSchema = z.object({
  format: z.literal(LIBRARY_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  codes: z.array(z.unknown()).max(MAX_CODES),
  folders: z.array(folderSchema).default([]),
  templates: z.array(templateSchema).default([]),
  assets: z.record(z.string(), z.string()).default({}),
});

export type ImportReport = {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  invalid: { index: number; name?: string; error: string }[];
  slugConflicts: { id: string; slug: string }[];
  folders: number;
  templates: number;
};

/** Validate and (optionally) import a library file. Imported passwords are never restored (hashes are not exported). */
export async function importLibrary(file: unknown, o: { dryRun: boolean; policy: "skip" | "overwrite" | "duplicate" }): Promise<ImportReport> {
  const parsed = libraryFileSchema.safeParse(file);
  if (!parsed.success) throw new RepoError("BAD_REQUEST", "Not a QR Studio library file", parsed.error.issues.slice(0, 5).map((i) => i.message));
  if (!o.dryRun) await assertWritable();
  const rep: ImportReport = { dryRun: o.dryRun, created: 0, updated: 0, skipped: 0, invalid: [], slugConflicts: [], folders: 0, templates: 0 };

  for (const [id, url] of Object.entries(parsed.data.assets)) {
    if (assetHash(url) !== id) throw new RepoError("BAD_REQUEST", "Logo hash does not match its content");
  }
  if (!o.dryRun) for (const [id, url] of Object.entries(parsed.data.assets)) await withRedis((r) => r.set(K.asset(id), url, { condition: "NX" }));

  for (const f of parsed.data.folders) { if (!o.dryRun) await upsertFolder(f); rep.folders++; }
  for (const t of parsed.data.templates) { if (!o.dryRun) await upsertTemplate(t); rep.templates++; }

  for (const [index, raw] of parsed.data.codes.entries()) {
    let rec: ReturnType<typeof qrRecordSchema.safeParse>;
    try {
      const protectedLink = typeof raw === "object" && raw !== null && (("hadPassword" in raw && raw.hadPassword === true) || ("hasPassword" in raw && raw.hasPassword === true));
      rec = qrRecordSchema.safeParse(migrateRecord({ ...(raw as object), password: null, ...(protectedLink ? { enabled: false } : {}) }));
    } catch (e) {
      rep.invalid.push({ index, error: e instanceof Error ? e.message : "Invalid record" }); // e.g. written by a newer build
      continue;
    }
    if (!rec.success) { rep.invalid.push({ index, error: rec.error.issues[0]?.message ?? "Invalid record" }); continue; }
    let r: QrRecord = rec.data;
    try {
      validateImported(r);
    } catch (e) {
      rep.invalid.push({ index, name: r.name, error: e instanceof Error ? e.message : "Invalid" });
      continue;
    }
    if (o.policy === "duplicate") r = { ...r, id: newId(), slug: r.mode === "dynamic" ? newSlug() : null, name: `${r.name} (imported)`, rev: 1 };
    if (o.dryRun) {
      const cur = await withRedis((c) => c.get(K.code(r.id)));
      const holder = r.slug ? await withRedis((c) => c.get(K.slug(r.slug!))) : null;
      if (holder && holder !== r.id) rep.slugConflicts.push({ id: r.id, slug: r.slug! });
      else if (cur && o.policy === "skip") rep.skipped++;
      else if (cur && o.policy === "overwrite") rep.updated++;
      else rep.created++;
      continue;
    }
    const stored = (SENSITIVE_TYPES.includes(r.type) ? seal(r) : r) as StoredRecord;
    const res = await upsertStored(stored, o.policy === "overwrite" ? "overwrite" : "skip");
    if (res === "created") rep.created++;
    else if (res === "updated") rep.updated++;
    else if (res === "slug_conflict") rep.slugConflicts.push({ id: r.id, slug: r.slug ?? "" });
    else rep.skipped++;
  }
  return rep;
}

export { purgeCode, storedSchema };
