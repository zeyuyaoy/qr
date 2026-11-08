import { z } from "zod";
import { sha256Hex } from "../crypto";
import { env } from "../env";
import { SCHEMA_VERSION, folderSchema, settingsSchema, templateSchema, type Folder, type Template } from "../schema";
import { withRedis } from "../redis/client";
import { K, assertOwnKey, prefix } from "../redis/keys";
import { assetHash, getMeta, initMeta, parseStoredLoose, purgeCode, validateImported, type Meta } from "../redis/repo";
import { readAllStored, scanOwn, upsertFolder, upsertStored, upsertTemplate, type StoredRecord } from "../redis/maintenance";
import { BackupFormatError, open as openEnvelope, parseEnvelope, seal as sealEnvelope, type Envelope } from "./envelope";

export const SNAPSHOT_FORMAT = "qr-studio-snapshot";

export type Snapshot = {
  format: typeof SNAPSHOT_FORMAT;
  version: 1;
  schemaVersion: number;
  createdAt: string;
  meta: Meta | null;
  /** Raw stored JSON strings (sealed fields stay sealed — the snapshot never needs the data key). */
  codes: string[];
  folders: Folder[];
  templates: Template[];
  settings: unknown | null;
  assets: Record<string, string>;
  counts: Record<string, number>;
  stats: { key: string; ttl: number; fields: Record<string, string> }[];
};

const snapshotShape = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  version: z.literal(1),
  schemaVersion: z.number().int().min(1),
  createdAt: z.string(),
  meta: z.object({ schemaVersion: z.number(), initializedAt: z.string(), instanceId: z.string() }).nullable(),
  codes: z.array(z.string()),
  folders: z.array(folderSchema),
  templates: z.array(templateSchema),
  settings: z.unknown().nullable(),
  assets: z.record(z.string(), z.string()),
  counts: z.record(z.string(), z.number()),
  stats: z.array(z.object({ key: z.string(), ttl: z.number(), fields: z.record(z.string(), z.string()) })),
});

// ---------------------------------------------------------------- collect
/** Everything below the `qr:v1:` prefix that is primary data. Indexes/slugs are derived and rebuilt on restore. */
export async function collectSnapshot(): Promise<{ snapshot: Snapshot; skipped: string[] }> {
  const meta = await getMeta();
  const { records, corrupt } = await readAllStored();
  const ids = [...records.keys()];
  const folderIds = await withRedis((r) => r.sMembers(K.indexFolders()));
  const tplIds = await withRedis((r) => r.sMembers(K.indexTemplates()));
  const folders: Folder[] = [];
  const templates: Template[] = [];
  if (folderIds.length) for (const raw of await withRedis((r) => r.mGet(folderIds.map(K.folder)))) if (raw) folders.push(folderSchema.parse(JSON.parse(raw)));
  if (tplIds.length) for (const raw of await withRedis((r) => r.mGet(tplIds.map(K.template)))) if (raw) templates.push(templateSchema.parse(JSON.parse(raw)));
  const settingsRaw = await withRedis((r) => r.get(K.settings()));
  const settings = settingsRaw ? settingsSchema.parse(JSON.parse(settingsRaw)) : null;

  const assetIds = new Set<string>();
  for (const { rec } of records.values()) if (rec.style.logo.assetId) assetIds.add(rec.style.logo.assetId);
  for (const t of templates) if (t.style.logo.assetId) assetIds.add(t.style.logo.assetId);
  if (settings?.defaultStyle.logo.assetId) assetIds.add(settings.defaultStyle.logo.assetId);
  const assets: Record<string, string> = {};
  const aList = [...assetIds];
  if (aList.length) {
    const vals = await withRedis((r) => r.mGet(aList.map(K.asset)));
    aList.forEach((id, i) => vals[i] && (assets[id] = vals[i]!));
  }

  const counts: Record<string, number> = {};
  if (ids.length) {
    const vals = await withRedis((r) => r.mGet(ids.map(K.count)));
    ids.forEach((id, i) => vals[i] && (counts[id] = Number(vals[i])));
  }

  const stats: Snapshot["stats"] = [];
  const statKeys = await scanOwn(`${prefix()}stats:*`, 20_000);
  const live = new Set(ids);
  const wanted = statKeys.filter((k) => {
    const [, id] = k.slice(prefix().length).split(":");
    return id === "all" || (id !== undefined && live.has(id));
  });
  for (let i = 0; i < wanted.length; i += 200) {
    const part = wanted.slice(i, i + 200);
    const rows = await withRedis(async (r) => {
      const m = r.multi();
      for (const k of part) m.hGetAll(k).ttl(k);
      return (await m.exec()) as unknown as (Record<string, string> | number)[];
    });
    part.forEach((k, j) => stats.push({ key: k.slice(`${prefix()}stats:`.length), fields: rows[j * 2] as Record<string, string>, ttl: Number(rows[j * 2 + 1]) }));
  }

  return {
    snapshot: {
      format: SNAPSHOT_FORMAT,
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      meta,
      codes: [...records.values()].map((x) => x.raw).sort(),
      folders: folders.sort((a, b) => a.id.localeCompare(b.id)),
      templates: templates.sort((a, b) => a.id.localeCompare(b.id)),
      settings,
      assets,
      counts,
      stats: stats.sort((a, b) => a.key.localeCompare(b.key)),
    },
    skipped: corrupt,
  };
}

/** Hash of the content only (not the timestamp) so unchanged data is detectable. */
// Stats TTLs count down every second, so they are excluded; otherwise no two snapshots would ever match.
export const contentHash = (s: Snapshot) =>
  sha256Hex(JSON.stringify({ ...s, createdAt: "", stats: s.stats.map(({ key, fields }) => ({ key, fields })) }));

export function packSnapshot(s: Snapshot, keyB64: string | undefined): { envelope: Envelope; text: string } {
  const plain = JSON.stringify(s);
  // The header carries the checksum of the exact plaintext (envelope.open verifies it). `contentHash` is a
  // different, timestamp-free hash used only to name snapshots and detect "unchanged".
  const envelope = sealEnvelope(plain, { createdAt: s.createdAt, schemaVersion: s.schemaVersion, recordCount: s.codes.length, contentSha256: sha256Hex(plain) }, keyB64);
  return { envelope, text: JSON.stringify(envelope) };
}

/** Decrypt, verify checksum, and structurally validate. Throws BackupFormatError; nothing is written. */
export function unpackSnapshot(text: string, keyB64: string | undefined): { snapshot: Snapshot; envelope: Envelope } {
  const envelope = parseEnvelope(text);
  const plain = openEnvelope(envelope, keyB64);
  const parsed = snapshotShape.safeParse(JSON.parse(plain));
  if (!parsed.success) throw new BackupFormatError(`Snapshot structure is invalid: ${parsed.error.issues[0]?.message}`);
  const snapshot = parsed.data as Snapshot;
  if (snapshot.schemaVersion > SCHEMA_VERSION) throw new BackupFormatError(`Snapshot is schema v${snapshot.schemaVersion}; this build supports up to v${SCHEMA_VERSION}`);
  if (snapshot.codes.length !== envelope.recordCount) throw new BackupFormatError("Record count does not match the header");
  return { snapshot, envelope };
}

// ---------------------------------------------------------------- restore
export type RestoreOptions = {
  dryRun: boolean;
  /** merge: add/update, never delete. replace: also remove codes/folders/templates that are not in the snapshot. */
  mode: "merge" | "replace";
  /** Conflict policy when a record exists on both sides with different content. */
  prefer: "newer" | "snapshot" | "existing";
};
export type RestoreReport = {
  dryRun: boolean;
  mode: RestoreOptions["mode"];
  prefer: RestoreOptions["prefer"];
  snapshotCreatedAt: string;
  codes: { create: number; update: number; unchanged: number; keptExisting: number; slugConflicts: number; invalid: number; delete: number };
  conflicts: { id: string; name: string; reason: string }[];
  folders: number;
  templates: number;
  assets: number;
  statsKeys: number;
  metaWillBeCreated: boolean;
  applied: boolean;
};

export async function restoreSnapshot(snapshot: Snapshot, o: RestoreOptions): Promise<RestoreReport> {
  const rep: RestoreReport = {
    dryRun: o.dryRun,
    mode: o.mode,
    prefer: o.prefer,
    snapshotCreatedAt: snapshot.createdAt,
    codes: { create: 0, update: 0, unchanged: 0, keptExisting: 0, slugConflicts: 0, invalid: 0, delete: 0 },
    conflicts: [],
    folders: snapshot.folders.length,
    templates: snapshot.templates.length,
    assets: Object.keys(snapshot.assets).length,
    statsKeys: snapshot.stats.length,
    metaWillBeCreated: false,
    applied: false,
  };

  // ---- 1. validate everything before the first write
  const incoming = new Map<string, StoredRecord>();
  for (const raw of snapshot.codes) {
    try {
      const rec = parseStoredLoose(raw) as StoredRecord;
      if (!rec.sealed) validateImported(rec);
      if (incoming.has(rec.id)) throw new BackupFormatError("Duplicate code id");
      incoming.set(rec.id, rec);
    } catch {
      rep.codes.invalid++;
    }
  }
  if (o.mode === "replace" && rep.codes.invalid) throw new BackupFormatError("Replace refused: snapshot contains invalid or duplicate records. Use merge to recover valid records.");
  if (snapshot.settings !== null && !settingsSchema.strict().safeParse(snapshot.settings).success) throw new BackupFormatError("Snapshot contains invalid settings");
  for (const [id, n] of Object.entries(snapshot.counts)) if (!/^[a-z0-9]{8,24}$/.test(id) || !Number.isSafeInteger(n) || n < 0) throw new BackupFormatError("Snapshot contains an invalid counter");
  for (const [id, url] of Object.entries(snapshot.assets)) {
    try { if (assetHash(url) !== id) throw new Error(); }
    catch { throw new BackupFormatError("Snapshot contains an invalid asset"); }
  }
  for (const s of snapshot.stats) if (!/^(all|[a-z0-9]{8,24}):\d{8}$/.test(s.key)) throw new BackupFormatError("Snapshot contains an invalid stats key");

  // ---- 2. plan against current state
  const { records: existing } = await readAllStored();
  const slugOwner = new Map<string, string>();
  for (const { rec } of existing.values()) if (rec.slug) slugOwner.set(rec.slug, rec.id);
  const toWrite: { rec: StoredRecord; policy: "skip" | "overwrite" }[] = [];
  for (const rec of incoming.values()) {
    const cur = existing.get(rec.id)?.rec;
    if (rec.slug && slugOwner.get(rec.slug) && slugOwner.get(rec.slug) !== rec.id) {
      rep.codes.slugConflicts++;
      rep.conflicts.push({ id: rec.id, name: rec.name, reason: `slug "${rec.slug}" is used by another code` });
      continue;
    }
    if (rec.slug) slugOwner.set(rec.slug, rec.id);
    if (!cur) { rep.codes.create++; toWrite.push({ rec, policy: "skip" }); continue; }
    if (JSON.stringify({ ...cur, rev: 0 }) === JSON.stringify({ ...rec, rev: 0 })) { rep.codes.unchanged++; continue; }
    const snapshotWins = o.prefer === "snapshot" || (o.prefer === "newer" && rec.updatedAt >= cur.updatedAt);
    if (snapshotWins) {
      rep.codes.update++;
      if (cur.updatedAt > rec.updatedAt) rep.conflicts.push({ id: rec.id, name: rec.name, reason: "existing copy is newer; overwritten by snapshot (prefer=snapshot)" });
      toWrite.push({ rec, policy: "overwrite" });
    } else {
      rep.codes.keptExisting++;
      rep.conflicts.push({ id: rec.id, name: rec.name, reason: "existing copy is newer; kept" });
    }
  }
  const toDelete = o.mode === "replace" ? [...existing.keys()].filter((id) => !incoming.has(id)) : [];
  rep.codes.delete = toDelete.length;
  rep.metaWillBeCreated = !(await getMeta());

  if (o.dryRun) return rep;

  // ---- 3. apply (idempotent; re-running completes an interrupted restore)
  for (const [hash, url] of Object.entries(snapshot.assets)) await withRedis((r) => r.set(K.asset(hash), url, { condition: "NX" }));
  for (const f of snapshot.folders) await upsertFolder(f);
  for (const t of snapshot.templates) await upsertTemplate(t);
  for (const { rec, policy } of toWrite) {
    const res = await upsertStored(rec, policy);
    if (res === "slug_conflict" || res === "skipped") throw new BackupFormatError("Library changed during restore; partial changes may have been applied. Review and retry before deleting anything.");
  }
  for (const [id, n] of Object.entries(snapshot.counts)) {
    if (incoming.has(id)) await withRedis((r) => r.eval("local n=tonumber(redis.call('GET',KEYS[1]) or '0'); if tonumber(ARGV[1])>n then redis.call('SET',KEYS[1],ARGV[1]) end; return 1", { keys: [K.count(id)], arguments: [String(n)] }));
  }
  for (const s of snapshot.stats) {
    const key = assertOwnKey(`${prefix()}stats:${s.key}`);
    const ttl = s.ttl - Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.createdAt)) / 1000));
    if (s.ttl !== -1 && ttl <= 0) continue;
    if (Object.keys(s.fields).length === 0) continue;
    await withRedis(async (r) => {
      const m = r.multi().hSet(key, s.fields);
      if (ttl > 0) m.expire(key, ttl);
      await m.exec();
    });
  }
  if (snapshot.settings && (o.mode === "replace" || o.prefer === "snapshot" || !(await withRedis((r) => r.exists(K.settings()))))) {
    await withRedis((r) => r.set(K.settings(), JSON.stringify(snapshot.settings)));
  }
  if (o.mode === "replace") {
    for (const id of toDelete) await purgeCode(id, true);
    const keepF = new Set(snapshot.folders.map((f) => f.id));
    for (const id of await withRedis((r) => r.sMembers(K.indexFolders()))) {
      if (!keepF.has(id)) await withRedis((r) => r.multi().del(K.folder(id)).del(K.indexFolder(id)).sRem(K.indexFolders(), id).exec());
    }
    const keepT = new Set(snapshot.templates.map((t) => t.id));
    for (const id of await withRedis((r) => r.sMembers(K.indexTemplates()))) {
      if (!keepT.has(id)) await withRedis((r) => r.multi().del(K.template(id)).sRem(K.indexTemplates(), id).exec());
    }
  }
  // Re-create the sentinel last: only a completed restore marks the library as initialised again.
  if (!(await getMeta())) {
    if (snapshot.meta) await withRedis((r) => r.set(K.meta(), JSON.stringify(snapshot.meta), { condition: "NX" }));
    else await initMeta();
  }
  rep.applied = true;
  return rep;
}

export const backupKey = () => env.backupKey();
