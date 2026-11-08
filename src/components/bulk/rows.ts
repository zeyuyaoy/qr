import { encodePayload } from "@/lib/qr/payload";
import { slugSchema, tagSchema } from "@/lib/schema";
import { looksLikeUrl, type CsvTable } from "./csv";

export const MAX_ROWS = 500;

/** Column index per field; -1 = not mapped. */
export type Mapping = { url: number; name: number; tags: number; slug: number; folder: number };
export const NO_MAPPING: Mapping = { url: 0, name: -1, tags: -1, slug: -1, folder: -1 };

export type BulkRow = {
  key: string;
  /** Position among data rows (stable id/slug pools are indexed by it). */
  index: number;
  /** Record number in the source (header counted), for messages. */
  line: number;
  rawUrl: string;
  /** Encoded URL; null when invalid. */
  payload: string | null;
  name: string;
  tags: string[];
  /** Slug from the file (dynamic mode only). */
  slug: string | null;
  folder: string | null;
  folderName: string | null;
  /** Why the row is excluded. */
  error: string | null;
  /** Line number of the first identical URL. */
  duplicateOf: number | null;
  notes: string[];
};

const HEADER_GUESS: Record<keyof Mapping, RegExp> = {
  url: /^(urls?|links?|href|web ?sites?|web ?address|address|destination|target|page|site)$/i,
  name: /^(names?|titles?|labels?|captions?|descriptions?)$/i,
  tags: /^(tags?|categories|category|keywords?)$/i,
  slug: /^(slugs?|short ?(code|link|url)?|alias|path)$/i,
  folder: /^(folders?|collections?|groups?|projects?)$/i,
};

/** Best-guess mapping from header names, falling back to the column that looks most like URLs. */
export function guessMapping(table: CsvTable, header: boolean): Mapping {
  const cols = Math.max(0, ...table.rows.slice(0, 50).map((r) => r.length));
  const m: Mapping = { ...NO_MAPPING };
  const head = header ? (table.rows[0] ?? []) : [];
  const claimed = new Set<number>();
  (Object.keys(HEADER_GUESS) as (keyof Mapping)[]).forEach((f) => {
    const i = head.findIndex((h, idx) => !claimed.has(idx) && HEADER_GUESS[f].test(h.trim()));
    if (i >= 0) {
      m[f] = i;
      claimed.add(i);
    }
  });
  if (m.url < 0) {
    const data = table.rows.slice(header ? 1 : 0, (header ? 1 : 0) + 50);
    let best = 0;
    let bestN = -1;
    for (let c = 0; c < cols; c++) {
      if (claimed.has(c)) continue;
      const n = data.filter((r) => looksLikeUrl(r[c] ?? "")).length;
      if (n > bestN) [best, bestN] = [c, n];
    }
    m.url = best;
  }
  return m;
}

const hostName = (u: string) => {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "") + (x.pathname.length > 1 ? x.pathname.replace(/\/$/, "") : "");
  } catch {
    return u;
  }
};

export type BuildOptions = { mode: "static" | "dynamic"; header: boolean; mapping: Mapping; folders: { id: string; name: string }[] | null };

/** Validate every row and flag duplicates. Pure: the same input always gives the same rows. */
export function buildRows(table: CsvTable, o: BuildOptions): { rows: BulkRow[]; truncated: number } {
  const start = o.header ? 1 : 0;
  const body = table.rows.slice(start);
  const rows: BulkRow[] = [];
  const firstByUrl = new Map<string, number>();
  const slugLine = new Map<string, number>();
  const folderByName = o.folders ? new Map(o.folders.map((f) => [f.name.trim().toLowerCase(), f])) : null;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  body.slice(0, MAX_ROWS).forEach((r, index) => {
    const line = table.lines[start + index] ?? index + 1 + start;
    const rawUrl = cell(r, o.mapping.url);
    const notes: string[] = [];
    let error: string | null = null;
    let payload: string | null = null;

    if (!rawUrl) error = "URL is empty";
    else {
      const enc = encodePayload("url", { url: rawUrl });
      if (enc.ok) payload = enc.payload;
      else error = enc.errors.url ?? Object.values(enc.errors)[0] ?? "Invalid URL";
    }

    let name = cell(r, o.mapping.name);
    if (name.length > 120) {
      name = name.slice(0, 120);
      notes.push("Name shortened to 120 characters");
    }
    if (!name) name = payload ? hostName(payload).slice(0, 120) : rawUrl.slice(0, 120) || `Row ${line}`;

    const tags: string[] = [];
    for (const t of cell(r, o.mapping.tags).split(/[|;]/)) {
      if (!t.trim()) continue;
      const p = tagSchema.safeParse(t);
      if (!p.success) error ??= `Invalid tag “${t.trim()}”: ${p.error.issues[0]?.message ?? "not allowed"}`;
      else if (!tags.includes(p.data)) tags.push(p.data);
    }
    if (tags.length > 20) error ??= `Too many tags (${tags.length}); the limit is 20`;

    let slug: string | null = null;
    const rawSlug = cell(r, o.mapping.slug).toLowerCase();
    if (rawSlug && o.mode === "dynamic") {
      const p = slugSchema.safeParse(rawSlug);
      if (!p.success) error ??= `Invalid slug “${rawSlug}”: ${p.error.issues[0]?.message ?? "not allowed"}`;
      else {
        slug = p.data;
        const prev = slugLine.get(slug);
        if (prev !== undefined) error ??= `Slug “${slug}” is already used by row ${prev}`;
        else slugLine.set(slug, line);
      }
    }

    let folder: string | null = null;
    let folderName: string | null = null;
    const rawFolder = cell(r, o.mapping.folder);
    if (rawFolder) {
      if (!folderByName) notes.push("Folders are unavailable, so the folder was ignored");
      else {
        const f = folderByName.get(rawFolder.toLowerCase());
        if (f) [folder, folderName] = [f.id, f.name];
        else error ??= `Unknown folder “${rawFolder}”. Create it in the library first`;
      }
    }

    let duplicateOf: number | null = null;
    if (payload && !error) {
      const first = firstByUrl.get(payload);
      if (first === undefined) firstByUrl.set(payload, line);
      else duplicateOf = first;
    }

    rows.push({ key: `r${index}`, index, line, rawUrl, payload, name, tags, slug, folder, folderName, error, duplicateOf, notes });
  });
  return { rows, truncated: Math.max(0, body.length - MAX_ROWS) };
}

export const isIncluded = (r: BulkRow, allowDuplicates: boolean) => !r.error && (r.duplicateOf === null || allowDuplicates);

/** Filenames made unique (case-insensitively) so a ZIP never silently overwrites entries. */
export function uniqueNames(items: { key: string; name: string }[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const { key, name } of items) {
    let n = name;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = name.replace(/(\.[^.]+)?$/, `-${i}$1`);
    used.add(n.toLowerCase());
    out.set(key, n);
  }
  return out;
}
