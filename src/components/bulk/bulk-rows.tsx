"use client";
import { Check, Download, Loader2, TriangleAlert } from "lucide-react";
import { memo, useState } from "react";
import { TAP } from "@/components/library/common";
import { LazyQr } from "@/components/library/lazy-qr";
import { Button } from "@/components/ui/button";
import type { QrStyle } from "@/lib/schema";
import { cn } from "@/lib/utils";
import type { BulkRow } from "./rows";
import type { SaveStatus } from "./use-bulk-run";

export type RowView = {
  row: BulkRow;
  included: boolean;
  /** Effective slug (dynamic mode). */
  slug: string | null;
  /** Exactly what the QR image encodes. */
  data: string | null;
  filename: string | null;
  save?: SaveStatus;
};

const PAGE = 50;

const BulkRowItem = memo(function BulkRowItem({ view, style, busy, onDownload }: { view: RowView; style: QrStyle; busy: boolean; onDownload: (key: string) => void }) {
  const { row, included, save } = view;
  const excluded = !included;
  return (
    <li className={cn("flex items-start gap-3 rounded-xl border bg-card p-2.5", excluded && "bg-muted/40")}>
      <div className="size-14 shrink-0">
        {view.data ? (
          <LazyQr data={view.data} style={style} size={112} label={`QR code for row ${row.line}`} className={cn("rounded-lg", excluded && "opacity-50")} />
        ) : (
          <div aria-hidden className="grid size-full place-items-center rounded-lg bg-destructive/10 text-destructive"><TriangleAlert className="size-5" /></div>
        )}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">{row.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">Row {row.line}</span>
        </p>
        <p className="break-all text-xs text-muted-foreground">{row.rawUrl || "(empty)"}</p>
        {included && (row.tags.length || view.slug || row.folderName) ? (
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {row.tags.length ? <span>Tags: {row.tags.join(", ")}</span> : null}
            {view.slug ? <span>/r/{view.slug}</span> : null}
            {row.folderName ? <span>Folder: {row.folderName}</span> : null}
          </p>
        ) : null}
        {row.error ? (
          <p className="mt-1 text-xs font-medium text-destructive">Excluded: {row.error}</p>
        ) : row.duplicateOf !== null ? (
          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Duplicate of row {row.duplicateOf}{included ? " (included)" : " (excluded)"}</p>
        ) : null}
        {row.notes.map((n) => <p key={n} className="mt-1 text-xs text-muted-foreground">{n}</p>)}
        {save?.state === "saved" ? (
          <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><Check className="size-3.5" aria-hidden /> Saved to library</p>
        ) : save?.state === "saving" ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…</p>
        ) : save?.state === "failed" ? (
          <p role="alert" className="mt-1 text-xs font-medium text-destructive">Not saved: {save.error}</p>
        ) : null}
      </div>
      {view.filename ? (
        <Button variant="ghost" size="icon" className="tap shrink-0" disabled={busy || excluded} aria-label={`Download ${view.filename}`} title={`Download ${view.filename}`} onClick={() => onDownload(row.key)}>
          <Download />
        </Button>
      ) : null}
    </li>
  );
});

/** Every parsed row with its validation result, thumbnail and (after saving) per-row outcome. */
export function BulkRows({ views, style, busy, onDownload }: { views: RowView[]; style: QrStyle; busy: boolean; onDownload: (key: string) => void }) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const problems = views.filter((v) => v.row.error || v.row.duplicateOf !== null || v.save?.state === "failed");
  const list = onlyProblems ? problems : views;
  const shown = list.slice(0, limit);
  return (
    <div className="grid gap-3">
      {problems.length ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-8">
          <input type="checkbox" className="size-5 accent-primary md:size-4" checked={onlyProblems} onChange={(e) => (setOnlyProblems(e.target.checked), setLimit(PAGE))} />
          Show only rows that need attention ({problems.length})
        </label>
      ) : null}
      <ul className="grid gap-2" aria-label="Rows">
        {shown.map((v) => <BulkRowItem key={v.row.key} view={v} style={style} busy={busy} onDownload={onDownload} />)}
      </ul>
      {list.length > shown.length ? (
        <Button variant="outline" className={cn(TAP, "justify-self-center")} onClick={() => setLimit((n) => n + PAGE)}>
          Show more ({shown.length} of {list.length})
        </Button>
      ) : null}
    </div>
  );
}
