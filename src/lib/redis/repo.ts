import { z } from "zod";
import { createHash } from "node:crypto";
import { env } from "../env";
import { hashPassword, hmacShort } from "../crypto";
import { evaluateLink } from "../expiry";
import { newId, newSlug } from "../ids";
import { encodePayload, isDynamicCapable, payloadFits } from "../qr/payload";
import {
  SCHEMA_VERSION,
  defaultSettings,
  folderSchema,
  qrRecordSchema,
  settingsSchema,
  templateSchema,
  type ApiErrorCode,
  type CreateInput,
  type Folder,
  type QrRecord,
  type QrView,
  type Settings,
  type Template,
  type UpdateInput,
} from "../schema";
import { open, seal, sealingAvailable, needsSealing, type Stored } from "../seal";
import { appHost, checkDestination } from "../url-safety";
import { RedisUnavailableError, runScript, withRedis } from "./client";
import { K, assertOwnKey, dayKey, prefix } from "./keys";
import { ACCEPT, HIT, PURGE, PUT, RESOLVE } from "./scripts";
import { migrateRecord } from "./migrate";

export class RepoError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const storedSchema = qrRecordSchema.extend({ sealed: z.string().optional() });
const nowIso = () => new Date().toISOString();
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
export const MAX_CODES = 10_000;

// ---------------------------------------------------------------- meta / health
export type Meta = { schemaVersion: number; initializedAt: string; instanceId: string };

export async function getMeta(): Promise<Meta | null> {
  const raw = await withRedis((r) => r.get(K.meta()));
  return raw ? (JSON.parse(raw) as Meta) : null;
}
/** Explicit, one-time initialisation. Never done implicitly, so total Redis loss is detectable. */
export async function initMeta(): Promise<Meta> {
  const meta: Meta = { schemaVersion: SCHEMA_VERSION, initializedAt: nowIso(), instanceId: newId() };
  await withRedis((r) => r.set(K.meta(), JSON.stringify(meta), { condition: "NX" }));
  return (await getMeta())!;
}
export async function assertWritable() {
  if (!(await withRedis((r) => r.exists(K.meta())))) {
    throw new RepoError("RECOVERY_REQUIRED", "This library has not been initialised or Redis has lost its data. Open the recovery screen.");
  }
}

export async function health() {
  const t0 = Date.now();
  try {
    const url = env.redisUrl() ?? "";
    const scripting = await withRedis(async (r) => {
      await r.ping();
      const v = await r.eval("return redis.call('PING')", { keys: [], arguments: [] }).catch(() => null);
      const info = await r.info("memory").catch(() => "");
      const used = /used_memory:(\d+)/.exec(info)?.[1];
      const max = /maxmemory:(\d+)/.exec(info)?.[1];
      return { scripting: v !== null, used: used ? +used : null, max: max && +max > 0 ? +max : null };
    });
    return { ok: true as const, latencyMs: Date.now() - t0, tls: url.startsWith("rediss://"), ...scripting };
  } catch (e) {
    return { ok: false as const, latencyMs: Date.now() - t0, tls: false, error: e instanceof RedisUnavailableError ? e.message : "Redis error" };
  }
}

// ---------------------------------------------------------------- (de)serialisation
export function parseStored(json: string): QrRecord {
  const raw = migrateRecord(JSON.parse(json));
  return open(storedSchema.parse(raw) as Stored);
}
export function parseStoredLoose(json: string): QrRecord & { sealed?: string } {
  return storedSchema.parse(migrateRecord(JSON.parse(json))) as QrRecord;
}
const serialize = (r: QrRecord) => JSON.stringify(seal(r));

export function toView(r: QrRecord, scans: number, now = Date.now()): QrView {
  const { password, ...rest } = r;
  return { ...rest, hasPassword: Boolean(password), scans, linkState: evaluateLink(r, now, scans).kind };
}

// ---------------------------------------------------------------- validation shared by create/update
function validateRecord(r: QrRecord) {
  if (r.mode === "dynamic") {
    if (!isDynamicCapable(r.type)) throw new RepoError("BAD_REQUEST", `${r.type} codes cannot be dynamic`);
    const c = checkDestination(r.payload, { appHost: appHost(env.appUrl()) });
    if (!c.ok) throw new RepoError("BAD_REQUEST", `Destination: ${c.reason}`);
    if (!r.slug) throw new RepoError("BAD_REQUEST", "Dynamic codes need a slug");
  } else if (!payloadFits(r.payload, r.style.ecc) && r.payload !== "sealed") {
    throw new RepoError("PAYLOAD_TOO_LARGE", "Content does not fit in a QR code at this error-correction level");
  }
  if (isDynamicCapable(r.type)) {
    const c = checkDestination(r.payload, { appHost: appHost(env.appUrl()) });
    if (!c.ok) throw new RepoError("BAD_REQUEST", `Destination: ${c.reason}`);
  }
  if (Object.keys(r.fields).length) {
    const enc = encodePayload(r.type, r.fields);
    if (!enc.ok) throw new RepoError("BAD_REQUEST", "Invalid fields", enc.errors);
    if (enc.payload !== r.payload) throw new RepoError("BAD_REQUEST", "Payload does not match the form fields");
  }
  if (r.afterExpiry.redirectUrl) {
    const c = checkDestination(r.afterExpiry.redirectUrl, { appHost: appHost(env.appUrl()) });
    if (!c.ok) throw new RepoError("BAD_REQUEST", `Replacement destination: ${c.reason}`);
  }
  const { activateAt, expiresAt } = r.schedule;
  if (activateAt && expiresAt && Date.parse(expiresAt) <= Date.parse(activateAt)) {
    throw new RepoError("BAD_REQUEST", "Expiry must be after activation");
  }
  if (needsSealing(r.type) && !sealingAvailable()) {
    throw new RepoError(
      "NOT_CONFIGURED",
      "Wi-Fi and contact codes contain secrets and Redis Cloud Free has no TLS. Set DATA_ENCRYPTION_KEY to store them on the server; they can still be generated and exported locally.",
    );
  }
}

export const validateImported = validateRecord;

async function assertFolder(id: string | null) {
  if (id && !(await withRedis((r) => r.exists(K.folder(id))))) throw new RepoError("BAD_REQUEST", "Folder does not exist");
}

export async function putRaw(mode: "create" | "update", rec: QrRecord, expectedRev: number, rawJson?: string) {
  const json = rawJson ?? serialize(rec);
  const res = (await withRedis((r) =>
    runScript(r, "put", PUT, [K.code(rec.id), K.indexCodes(), K.indexTags()], [
      prefix(),
      mode,
      rec.id,
      json,
      expectedRev,
      rec.slug ?? "",
      Date.parse(rec.createdAt),
      rec.folder ?? "",
      JSON.stringify(rec.tags),
      MAX_CODES,
    ]),
  )) as string[];
  return res;
}

// ---------------------------------------------------------------- codes
export async function createCode(input: CreateInput): Promise<QrRecord> {
  await assertWritable();
  await assertFolder(input.folder ?? null);
  const now = nowIso();
  const dynamic = input.mode === "dynamic";
  const userSlug = dynamic ? (input.slug ?? null) : null;
  const password = input.password ? { hash: await hashPassword(input.password), setAt: now } : null;

  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = dynamic ? (userSlug ?? newSlug(attempt > 2 ? 9 : 7)) : null;
    const rec = qrRecordSchema.parse({
      v: SCHEMA_VERSION,
      id: input.id ?? newId(),
      opId: input.opId,
      name: input.name,
      description: input.description ?? "",
      type: input.type,
      mode: input.mode,
      fields: input.fields ?? {},
      payload: input.payload,
      slug,
      style: input.style,
      tags: [...new Set(input.tags ?? [])],
      folder: input.folder ?? null,
      favorite: input.favorite ?? false,
      pinned: input.pinned ?? false,
      status: input.status ?? "active",
      enabled: input.enabled ?? true,
      schedule: input.schedule ?? { activateAt: null, expiresAt: null, expireAfterSeconds: null },
      scanLimit: input.scanLimit ?? null,
      password,
      afterExpiry: input.afterExpiry ?? { message: null, redirectUrl: null },
      analytics: input.analytics ?? true,
      rev: 1,
      createdAt: now,
      updatedAt: now,
    });
    validateRecord(rec);
    const [status, cur] = await putRaw("create", rec, 0);
    if (status === "OK") return rec;
    if (status === "CAPACITY") throw new RepoError("CONFLICT", "Library is full. Export and delete unused codes before adding more.");
    if (status === "EXISTS") {
      const existing = parseStored(cur!);
      if (input.opId && existing.opId === input.opId) return existing; // idempotent retry of an offline create
      throw new RepoError("CONFLICT", "A code with this id already exists");
    }
    if (status === "SLUG" && !userSlug) continue; // random collision → try another
    if (status === "SLUG") throw new RepoError("SLUG_TAKEN", "That slug is already in use");
  }
  throw new RepoError("INTERNAL", "Could not allocate a unique slug");
}

export async function getCode(id: string): Promise<QrRecord | null> {
  const raw = await withRedis((r) => r.get(K.code(id)));
  return raw ? parseStored(raw) : null;
}

export async function updateCode(id: string, patch: Omit<UpdateInput, "ifRev"> & { ifRev?: number }): Promise<QrRecord> {
  await assertWritable();
  const cur = await getCode(id);
  if (!cur) throw new RepoError("NOT_FOUND", "Code not found");
  if (patch.ifRev !== undefined && patch.ifRev !== cur.rev) {
    throw new RepoError("REV_MISMATCH", "This code was changed elsewhere", { current: toView(cur, 0) });
  }
  const { ifRev: _i, password: pw, ...fields } = patch;
  void _i;
  const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const now = nowIso();
  let password = cur.password;
  if (pw === null) password = null;
  else if (typeof pw === "string") password = { hash: await hashPassword(pw), setAt: now };

  // id, createdAt and opId are immutable regardless of what the caller passes.
  const merged: Record<string, unknown> = { ...cur, ...defined, id: cur.id, createdAt: cur.createdAt, opId: cur.opId, password, rev: cur.rev + 1, updatedAt: now };
  if (merged.mode === "static") merged.slug = null;
  else if (!merged.slug) merged.slug = newSlug();
  if (merged.tags) merged.tags = [...new Set(merged.tags as string[])];
  const rec = qrRecordSchema.parse(merged);
  validateRecord(rec);
  await assertFolder(rec.folder);

  const [status, current] = await putRaw("update", rec, cur.rev);
  if (status === "OK") return rec;
  if (status === "SLUG") throw new RepoError("SLUG_TAKEN", "That slug is already in use");
  if (status === "REV") throw new RepoError("REV_MISMATCH", "This code was changed elsewhere", { current: toView(parseStored(current!), 0) });
  throw new RepoError("NOT_FOUND", "Code not found");
}

/** Permanent delete. Normal deletion is `status: "trashed"`; this is for "delete forever". */
export async function purgeCode(id: string, recovery = false): Promise<boolean> {
  if (!recovery) await assertWritable();
  const n = (await withRedis((r) =>
    runScript(r, "purge", PURGE, [K.code(id), K.indexCodes(), K.indexTags(), K.count(id)], [prefix(), id]),
  )) as number;
  return n === 1;
}

export async function listCodes(): Promise<{ records: QrRecord[]; unreadable: string[]; scans: Map<string, number> }> {
  const ids = await withRedis((r) => r.zRange(K.indexCodes(), 0, MAX_CODES - 1));
  const records: QrRecord[] = [];
  const unreadable: string[] = [];
  const scans = new Map<string, number>();
  for (const part of chunk(ids, 400)) {
    const [raws, counts] = await withRedis((r) =>
      Promise.all([r.mGet(part.map(K.code)), r.mGet(part.map(K.count))]),
    );
    part.forEach((id, i) => {
      const raw = raws[i];
      if (!raw) return;
      try {
        records.push(parseStored(raw));
        scans.set(id, Number(counts[i] ?? 0));
      } catch {
        unreadable.push(id);
      }
    });
  }
  return { records, unreadable, scans };
}

export async function scanCount(id: string): Promise<number> {
  return Number((await withRedis((r) => r.get(K.count(id)))) ?? 0);
}

// ---------------------------------------------------------------- public resolver hot path
export async function resolveSlug(slug: string): Promise<{ record: QrRecord; scans: number; settings: Settings } | null> {
  const res = (await withRedis((r) => runScript(r, "resolve", RESOLVE, [K.slug(slug)], [prefix()]))) as [string, string, string] | false | null;
  if (!res) return null;
  // The public path never needs sealed contents (only URL types can be dynamic), so don't decrypt.
  const parsed = res[2] ? settingsSchema.safeParse(JSON.parse(res[2])) : null;
  return { record: parseStoredLoose(res[0]), scans: Number(res[1]), settings: parsed?.success ? parsed.data : defaultSettings() };
}

export type AcceptOpts = {
  id: string;
  limit: number | null;
  analytics: boolean;
  retentionDays: number;
  device?: string;
  country?: string;
  expectedRev?: number;
  expiresAt?: number | null;
};
/** Returns the accepted-scan ordinal, or null if the scan limit was already exhausted. */
export async function acceptScan(o: AcceptOpts): Promise<number | null> {
  const day = dayKey(Date.now());
  const recent = o.analytics ? `${Math.floor(Date.now() / 1000)}|${o.id}|${o.device ?? ""}` : "";
  const n = (await withRedis((r) =>
    runScript(r, "accept", ACCEPT, [K.count(o.id), K.stats(o.id, day), K.statsAll(day), K.recent(), K.code(o.id)], [
      o.limit ?? 0,
      o.analytics ? 1 : 0,
      (o.retentionDays + 1) * 86_400,
      o.device ?? "",
      o.country ?? "",
      recent,
      100,
      o.id,
      o.expectedRev ?? "",
      Date.now(),
      o.expiresAt ?? "",
    ]),
  )) as number;
  if (n === -2) throw new RedisUnavailableError("Link changed during resolution; retry");
  return n === -1 ? null : n;
}

export async function recordExists(): Promise<boolean> {
  return Boolean(await withRedis((r) => r.exists(K.meta())));
}

// ---------------------------------------------------------------- rate limiting
export async function hit(bucket: string, windowSec: number): Promise<number> {
  const win = Math.floor(Date.now() / 1000 / windowSec);
  return (await withRedis((r) => runScript(r, "hit", HIT, [K.rl(`${bucket}:${win}`)], [windowSec * 2]))) as number;
}
export const visitorKey = (ip: string) => hmacShort(process.env.AUTH_SECRET ?? "dev", "rl", ip);

// ---------------------------------------------------------------- folders
export async function listFolders(): Promise<(Folder & { count: number })[]> {
  const ids = await withRedis((r) => r.sMembers(K.indexFolders()));
  if (!ids.length) return [];
  const [raws, counts] = await withRedis((r) => Promise.all([r.mGet(ids.map(K.folder)), Promise.all(ids.map((i) => r.sCard(K.indexFolder(i))))]));
  return raws
    .map((raw, i) => (raw ? { ...folderSchema.parse(JSON.parse(raw)), count: counts[i] ?? 0 } : null))
    .filter((f): f is Folder & { count: number } => f !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function saveFolder(input: { id?: string; name: string; color?: string | null }): Promise<Folder> {
  await assertWritable();
  const now = nowIso();
  const existing = input.id ? await withRedis((r) => r.get(K.folder(input.id!))) : null;
  if (input.id && !existing) throw new RepoError("NOT_FOUND", "Folder not found");
  const prev = existing ? folderSchema.parse(JSON.parse(existing)) : null;
  const f = folderSchema.parse({ id: prev?.id ?? newId(), name: input.name, color: input.color ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now });
  await withRedis((r) => r.multi().set(K.folder(f.id), JSON.stringify(f)).sAdd(K.indexFolders(), f.id).exec());
  return f;
}
export async function deleteFolder(id: string): Promise<number> {
  await assertWritable();
  const members = await withRedis((r) => r.sMembers(K.indexFolder(id)));
  for (const codeId of members) await updateCode(codeId, { folder: null });
  await withRedis((r) => r.multi().del(K.folder(id)).del(K.indexFolder(id)).sRem(K.indexFolders(), id).exec());
  return members.length;
}

// ---------------------------------------------------------------- tags
export async function listTags(): Promise<{ tag: string; count: number }[]> {
  const tags = await withRedis((r) => r.sMembers(K.indexTags()));
  const counts = await withRedis((r) => Promise.all(tags.map((t) => r.sCard(K.indexTag(t)))));
  return tags.map((tag, i) => ({ tag, count: counts[i] ?? 0 })).sort((a, b) => a.tag.localeCompare(b.tag));
}
/** Rename/merge (to = new name) or delete (to = null) a tag across all codes. */
export async function retag(from: string, to: string | null): Promise<number> {
  await assertWritable();
  const ids = await withRedis((r) => r.sMembers(K.indexTag(from)));
  let n = 0;
  for (const id of ids.slice(0, MAX_CODES)) {
    const c = await getCode(id);
    if (!c) continue;
    const tags = c.tags.filter((t) => t !== from);
    if (to) tags.push(to);
    await updateCode(id, { tags });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- templates
export async function listTemplates(): Promise<Template[]> {
  const ids = await withRedis((r) => r.sMembers(K.indexTemplates()));
  if (!ids.length) return [];
  const raws = await withRedis((r) => r.mGet(ids.map(K.template)));
  return raws
    .filter((x): x is string => Boolean(x))
    .map((x) => templateSchema.parse(JSON.parse(x)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function saveTemplate(input: { id?: string; name: string; style: unknown }): Promise<Template> {
  await assertWritable();
  const now = nowIso();
  const existing = input.id ? await withRedis((r) => r.get(K.template(input.id!))) : null;
  if (input.id && !existing) throw new RepoError("NOT_FOUND", "Template not found");
  const prev = existing ? templateSchema.parse(JSON.parse(existing)) : null;
  const t = templateSchema.parse({ id: prev?.id ?? input.id ?? newId(), name: input.name, style: input.style, createdAt: prev?.createdAt ?? now, updatedAt: now });
  await withRedis((r) => r.multi().set(K.template(t.id), JSON.stringify(t)).sAdd(K.indexTemplates(), t.id).exec());
  return t;
}
export async function deleteTemplate(id: string): Promise<void> {
  await assertWritable();
  await withRedis((r) => r.multi().del(K.template(id)).sRem(K.indexTemplates(), id).exec());
}

// ---------------------------------------------------------------- settings
export async function getSettings(): Promise<Settings> {
  const raw = await withRedis((r) => r.get(K.settings()));
  return raw ? settingsSchema.parse(JSON.parse(raw)) : defaultSettings();
}
export async function saveSettings(s: unknown): Promise<Settings> {
  await assertWritable();
  const parsed = settingsSchema.parse({ ...(s as object), updatedAt: nowIso() });
  await withRedis((r) => r.set(K.settings(), JSON.stringify(parsed)));
  return parsed;
}

// ---------------------------------------------------------------- assets (logos)
export const MAX_ASSET_BYTES = 12 * 1024;
export function assetHash(dataUrl: string): string {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new RepoError("BAD_REQUEST", "Logo must be a PNG, JPEG or WebP data URL (SVG is rasterised in the browser)");
  const bytes = Buffer.from(m[2]!, "base64");
  if (bytes.length > MAX_ASSET_BYTES) throw new RepoError("PAYLOAD_TOO_LARGE", `Logo is ${bytes.length} bytes; limit is ${MAX_ASSET_BYTES}`);
  const magic = bytes.subarray(0, 12);
  const ok =
    (m[1] === "image/png" && magic[0] === 0x89 && magic.subarray(1, 4).toString() === "PNG") ||
    (m[1] === "image/jpeg" && magic[0] === 0xff && magic[1] === 0xd8) ||
    (m[1] === "image/webp" && magic.subarray(0, 4).toString() === "RIFF" && magic.subarray(8, 12).toString() === "WEBP");
  if (!ok) throw new RepoError("BAD_REQUEST", "File contents do not match the declared image type");
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  return hash;
}
export async function putAsset(dataUrl: string): Promise<string> {
  await assertWritable();
  const hash = assetHash(dataUrl);
  await withRedis((r) => r.set(K.asset(hash), dataUrl, { condition: "NX" }));
  return hash;
}
export async function getAsset(hash: string): Promise<string | null> {
  if (!/^[a-f0-9]{16,64}$/.test(hash)) return null;
  return withRedis((r) => r.get(K.asset(hash)));
}

// ---------------------------------------------------------------- analytics
export type DayStats = { day: string; total: number; devices: Record<string, number>; countries: Record<string, number>; codes: Record<string, number> };

function foldHash(day: string, h: Record<string, string>): DayStats {
  const out: DayStats = { day, total: Number(h.n ?? 0), devices: {}, countries: {}, codes: {} };
  for (const [k, v] of Object.entries(h)) {
    if (k.startsWith("d:")) out.devices[k.slice(2)] = Number(v);
    else if (k.startsWith("c:")) out.countries[k.slice(2)] = Number(v);
    else if (k.startsWith("k:")) out.codes[k.slice(2)] = Number(v);
  }
  return out;
}
export function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= to.getTime() && out.length < 366; t += 86_400_000) out.push(dayKey(t));
  return out;
}
export async function readStats(days: string[], id?: string): Promise<DayStats[]> {
  const rows = await withRedis(async (r) => {
    const m = r.multi();
    for (const d of days) m.hGetAll(id ? K.stats(id, d) : K.statsAll(d));
    return (await m.exec()) as unknown as Record<string, string>[];
  });
  return days.map((d, i) => foldHash(d, rows[i] ?? {}));
}
export async function recentActivity(limit = 50): Promise<{ at: string; id: string; device: string }[]> {
  const raw = await withRedis((r) => r.lRange(K.recent(), 0, limit - 1));
  return raw.map((s) => {
    const [ts, id, device] = s.split("|");
    return { at: new Date(Number(ts) * 1000).toISOString(), id: id ?? "", device: device ?? "" };
  });
}

/** Delete analytics for one code, or all analytics, using bounded SCAN over our own prefix only. */
export async function resetAnalytics(id?: string): Promise<number> {
  await assertWritable();
  const patterns = id ? [`${prefix()}stats:${id}:*`, K.count(id)] : [`${prefix()}stats:*`, `${prefix()}count:*`, K.recent()];
  let deleted = 0;
  await withRedis(async (r) => {
    for (const pat of patterns) {
      if (!pat.includes("*")) {
        deleted += await r.del(assertOwnKey(pat));
        continue;
      }
      let cursor = "0";
      let rounds = 0;
      do {
        const res = await r.scan(cursor, { MATCH: pat, COUNT: 500 });
        cursor = res.cursor;
        if (res.keys.length) deleted += await r.unlink(res.keys.map(assertOwnKey));
      } while (cursor !== "0" && ++rounds < 200);
    }
    if (id) {
      // remove this code's share from the global per-day hashes (bounded to the retention horizon)
      const m = r.multi();
      for (const d of daysBetween(new Date(Date.now() - 365 * 86_400_000), new Date())) m.hDel(K.statsAll(d), `k:${id}`);
      await m.exec();
    }
  });
  return deleted;
}
