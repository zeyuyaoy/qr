"use client";
import { ArrowDownAZ, ArrowUpAZ, CheckSquare, LayoutGrid, List, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TYPES } from "@/lib/qr/payload";
import { CONTENT_TYPES } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { TAP } from "./common";
import { activeFilterCount, DEFAULT_FILTERS, TABS, type Filters, type Tab } from "./filters";
import type { FolderWithCount } from "./use-library";

const SORTS: { id: Filters["sort"]; label: string }[] = [
  { id: "updated", label: "Last updated" },
  { id: "created", label: "Date created" },
  { id: "name", label: "Name" },
  { id: "scans", label: "Scans" },
];
const STATES: { id: Filters["state"]; label: string }[] = [
  { id: "", label: "Any link state" },
  { id: "ok", label: "Live" },
  { id: "paused", label: "Paused" },
  { id: "not_yet", label: "Scheduled" },
  { id: "expired", label: "Expired" },
  { id: "exhausted", label: "Limit reached" },
];

export function LibraryToolbar({
  tab,
  onTab,
  counts,
  filters,
  onFilters,
  folders,
  tags,
  layout,
  onLayout,
  selecting,
  onSelecting,
  shown,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  counts: Record<Tab, number>;
  filters: Filters;
  onFilters: (f: Filters) => void;
  folders: FolderWithCount[];
  tags: { tag: string; count: number }[];
  layout: "grid" | "list";
  onLayout: (l: "grid" | "list") => void;
  selecting: boolean;
  onSelecting: (v: boolean) => void;
  shown: number;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const n = activeFilterCount(filters);
  const dirty = n > 0 || filters.q.trim() !== "";

  return (
    <div className="mb-4 grid min-w-0 gap-3">
      <Tabs value={tab} onValueChange={(v) => onTab(v as Tab)}>
        <TabsList aria-label="Library sections" className="h-auto w-full justify-start gap-1 overflow-x-auto group-data-horizontal/tabs:h-auto md:w-fit">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="h-auto min-h-10 flex-none px-3 md:min-h-7">
              {t.label}
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", t.id === "pending" && counts.pending > 0 ? "bg-amber-500/20 text-amber-800 dark:text-amber-200" : "text-muted-foreground")}>{counts[t.id]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search codes by name, description, slug, destination or tag"
            placeholder="Search name, destination, slug, tag…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            className="h-11 pl-9 pr-10 md:h-9"
          />
          {filters.q ? (
            <button type="button" aria-label="Clear search" onClick={() => set({ q: "" })} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
        <Button variant={open || n ? "secondary" : "outline"} className={TAP} aria-expanded={open} aria-controls="library-filters" onClick={() => setOpen((v) => !v)}>
          <SlidersHorizontal /> Filters{n ? ` (${n})` : ""}
        </Button>
        <Button variant={filters.favorite ? "secondary" : "outline"} className={TAP} aria-pressed={filters.favorite} onClick={() => set({ favorite: !filters.favorite })}>
          <Star className={cn(filters.favorite && "fill-amber-400 text-amber-500")} /> Favorites
        </Button>
        <div role="group" aria-label="Layout" className="flex overflow-hidden rounded-lg border">
          <Button variant={layout === "grid" ? "secondary" : "ghost"} size="icon" className="tap rounded-none" aria-pressed={layout === "grid"} aria-label="Grid view" onClick={() => onLayout("grid")}>
            <LayoutGrid />
          </Button>
          <Button variant={layout === "list" ? "secondary" : "ghost"} size="icon" className="tap rounded-none" aria-pressed={layout === "list"} aria-label="List view" onClick={() => onLayout("list")}>
            <List />
          </Button>
        </div>
        <Button variant={selecting ? "secondary" : "outline"} className={TAP} aria-pressed={selecting} onClick={() => onSelecting(!selecting)}>
          <CheckSquare /> {selecting ? "Done" : "Select"}
        </Button>
      </div>

      {open ? (
        <div id="library-filters" className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Type">{(a) => <NativeSelect {...a} value={filters.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="">All types</option>
            {CONTENT_TYPES.map((t) => <option key={t} value={t}>{TYPES[t].label}</option>)}
          </NativeSelect>}</Field>
          <Field label="Mode">{(a) => <NativeSelect {...a} value={filters.mode} onChange={(e) => set({ mode: e.target.value as Filters["mode"] })}>
            <option value="">Static and dynamic</option>
            <option value="static">Static only</option>
            <option value="dynamic">Dynamic only</option>
          </NativeSelect>}</Field>
          <Field label="Folder">{(a) => <NativeSelect {...a} value={filters.folder} onChange={(e) => set({ folder: e.target.value })}>
            <option value="">All folders</option>
            <option value="none">No folder</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </NativeSelect>}</Field>
          <Field label="Tag">{(a) => <NativeSelect {...a} value={filters.tag} onChange={(e) => set({ tag: e.target.value })}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
            {filters.tag && !tags.some((t) => t.tag === filters.tag) ? <option value={filters.tag}>{filters.tag}</option> : null}
          </NativeSelect>}</Field>
          <Field label="Link state">{(a) => <NativeSelect {...a} value={filters.state} onChange={(e) => set({ state: e.target.value as Filters["state"] })}>
            {STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </NativeSelect>}</Field>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Sort</span>
            <div className="flex gap-2">
              <NativeSelect aria-label="Sort by" value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"], dir: e.target.value === "name" ? "asc" : "desc" })}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </NativeSelect>
              <Button variant="outline" size="icon" className="tap shrink-0" aria-label={filters.dir === "asc" ? "Ascending. Switch to descending" : "Descending. Switch to ascending"} onClick={() => set({ dir: filters.dir === "asc" ? "desc" : "asc" })}>
                {filters.dir === "asc" ? <ArrowUpAZ /> : <ArrowDownAZ />}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Pinned codes always stay at the top.</p>
        </div>
      ) : null}

      <div className="flex min-h-6 items-center justify-between gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span>
          {shown.toLocaleString()} {shown === 1 ? "code" : "codes"}
          {dirty ? " match" : ""}
        </span>
        {dirty ? (
          <Button variant="link" className="h-auto min-h-8 p-0" onClick={() => onFilters({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir })}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
