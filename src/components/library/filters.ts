import {type LibraryQuery, queryLibrary} from "@/lib/library-query";
import type {CachedView} from "@/lib/client/offline";
import type {QrView} from "@/lib/schema";

export type Tab = "active" | "archived" | "trashed" | "pending";
export const TABS: { id: Tab; label: string }[] = [
    {id: "active", label: "Active"},
    {id: "archived", label: "Archived"},
    {id: "trashed", label: "Trash"},
    {id: "pending", label: "Pending sync"},
];
export const parseTab = (v: string | null): Tab => (v === "archived" || v === "trashed" || v === "pending" ? v : "active");

export type Filters = {
    q: string;
    type: string;
    mode: "" | "static" | "dynamic";
    folder: string;
    tag: string;
    favorite: boolean;
    state: "" | QrView["linkState"];
    sort: NonNullable<LibraryQuery["sort"]>;
    dir: "asc" | "desc";
};
export const DEFAULT_FILTERS: Filters = {
    q: "",
    type: "",
    mode: "",
    folder: "",
    tag: "",
    favorite: false,
    state: "",
    sort: "updated",
    dir: "desc"
};

export const activeFilterCount = (f: Filters) => [f.type, f.mode, f.folder, f.tag, f.state].filter(Boolean).length + (f.favorite ? 1 : 0);

const isPendingItem = (i: CachedView) => Boolean(i._pending || i._error);

export function filterItems(items: CachedView[], tab: Tab, f: Filters, q: string): CachedView[] {
    const query: LibraryQuery = {
        q,
        status: tab === "pending" ? "all" : tab,
        type: f.type || undefined,
        mode: f.mode || undefined,
        folder: f.folder || undefined,
        tag: f.tag || undefined,
        favorite: f.favorite || undefined,
        state: f.state || undefined,
        sort: f.sort,
        dir: f.dir,
    };
    const out = queryLibrary(items, query) as CachedView[];
    return tab === "pending" ? out.filter(isPendingItem) : out;
}

export function tabCounts(items: CachedView[]): Record<Tab, number> {
    const c: Record<Tab, number> = {active: 0, archived: 0, trashed: 0, pending: 0};
    for (const i of items) {
        if (i.status === "active") c.active++;
        else if (i.status === "archived") c.archived++;
        else c.trashed++;
        if (isPendingItem(i)) c.pending++;
    }
    return c;
}

export function countTags(items: CachedView[]): { tag: string; count: number }[] {
    const m = new Map<string, number>();
    for (const i of items) if (i.status !== "trashed") for (const t of i.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].map(([tag, count]) => ({tag, count})).sort((a, b) => a.tag.localeCompare(b.tag));
}
