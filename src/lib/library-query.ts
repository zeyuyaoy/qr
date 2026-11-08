import type { QrView } from "./schema";

export type LibraryQuery = {
  q?: string;
  /** "active" (default) | "archived" | "trashed" | "all" */
  status?: "active" | "archived" | "trashed" | "all";
  type?: string;
  mode?: "static" | "dynamic";
  folder?: string | "none";
  tag?: string;
  favorite?: boolean;
  /** live link state filter, e.g. "expired" */
  state?: QrView["linkState"];
  sort?: "updated" | "created" | "name" | "scans";
  dir?: "asc" | "desc";
};

const norm = (s: string) => s.toLowerCase();

/** Pure filter+sort shared by the API and the offline (cached) library so both behave identically. Pinned items always float first. */
export function queryLibrary(items: QrView[], q: LibraryQuery): QrView[] {
  const status = q.status ?? "active";
  const needle = q.q ? norm(q.q.trim()) : "";
  const out = items.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (q.type && r.type !== q.type) return false;
    if (q.mode && r.mode !== q.mode) return false;
    if (q.folder === "none" ? r.folder !== null : q.folder && r.folder !== q.folder) return false;
    if (q.tag && !r.tags.includes(q.tag)) return false;
    if (q.favorite && !r.favorite) return false;
    if (q.state && r.linkState !== q.state) return false;
    if (needle) {
      const hay = norm([r.name, r.description, r.slug ?? "", r.mode === "dynamic" ? r.payload : "", r.type, ...r.tags].join("\n"));
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const dir = q.dir === "asc" ? 1 : -1;
  const key = q.sort ?? "updated";
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const c = key === "name" ? a.name.localeCompare(b.name) : key === "scans" ? a.scans - b.scans : key === "created" ? a.createdAt.localeCompare(b.createdAt) : a.updatedAt.localeCompare(b.updatedAt);
    return key === "name" ? c * (q.dir === "desc" ? -1 : 1) : c * dir;
  });
  return out;
}
