"use client";
import { Check, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { queryLibrary } from "@/lib/library-query";
import { TYPES } from "@/lib/qr/payload";
import type { QrView } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { ErrorNotice, errMsg, TAP, useDebounced } from "@/components/library/common";
import { LazyQr } from "@/components/library/lazy-qr";
import { itemData, runBatch } from "@/components/library/library-actions";

const ROWS = 200;

/**
 * Pick existing codes and restyle them with a template. `resolveTemplateId` lets built-in presets be
 * saved as a user template just in time (the API only applies saved templates).
 */
export function ApplyDialog({ open, name, builtIn, offline, resolveTemplateId, onClose }: { open: boolean; name: string; builtIn: boolean; offline: boolean; resolveTemplateId: () => Promise<string>; onClose: () => void }) {
  const [codes, setCodes] = useState<QrView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: { name: string; error: string }[] } | null>(null);
  const q = useDebounced(search, 150);

  useEffect(() => {
    if (!open || offline) return;
    let alive = true;
    api.codes.all({ status: "active", sort: "updated", dir: "desc" }).then(
      (r) => alive && (setCodes(r.items), setError(null)),
      (e) => alive && setError(errMsg(e)),
    );
    return () => {
      alive = false;
    };
  }, [open, offline, tick]);

  const shown = useMemo(() => (codes ? queryLibrary(codes, { q, status: "active", sort: "updated", dir: "desc" }) : []), [codes, q]);
  const rows = shown.slice(0, ROWS);
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const close = () => {
    if (busy) return;
    setPicked(new Set());
    setSearch("");
    setResult(null);
    onClose();
  };

  const apply = async () => {
    setBusy(true);
    setResult(null);
    try {
      const templateId = await resolveTemplateId();
      const ids = [...picked];
      const results = await runBatch(ids, "apply-template", templateId);
      const byId = new Map((codes ?? []).map((c) => [c.id, c.name]));
      const failed = results.filter((r) => !r.ok).map((r) => ({ name: byId.get(r.id) ?? r.id, error: r.error ?? "Failed" }));
      setResult({ ok: results.length - failed.length, failed });
      setPicked(new Set(results.filter((r) => !r.ok).map((r) => r.id)));
      if (!failed.length) toast.success(`Applied “${name}” to ${results.length} ${results.length === 1 ? "code" : "codes"}`);
      else toast.warning(`Applied to ${results.length - failed.length} of ${results.length}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply “{name}” to existing codes</DialogTitle>
          <DialogDescription>
            Replaces the style of the codes you pick. Their content and links stay the same.
            {builtIn ? " This built-in preset will be saved to your templates first." : ""}
          </DialogDescription>
        </DialogHeader>
        {offline ? (
          <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">Applying a template needs a connection.</p>
        ) : error ? (
          <ErrorNotice title="Could not load your codes" message={error} onRetry={() => { setError(null); setTick((n) => n + 1); }} />
        ) : !codes ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading codes…</p>
        ) : codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no active codes yet.</p>
        ) : (
          <>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Search codes" placeholder="Search codes…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 pl-9 md:h-9" />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-sm">
              <span aria-live="polite" className="font-medium">{picked.size} selected</span>
              <Button variant="link" className="h-auto min-h-8 p-0" onClick={() => setPicked(new Set([...picked, ...shown.map((c) => c.id)]))} disabled={shown.length === 0}>Select all {shown.length}</Button>
              <Button variant="link" className="h-auto min-h-8 p-0" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>Clear</Button>
            </div>
            <ul aria-label="Codes" className="-mx-1 grid min-h-0 flex-1 gap-1 overflow-y-auto px-1">
              {rows.map((c) => {
                const on = picked.has(c.id);
                return (
                  <li key={c.id}>
                    <button type="button" aria-pressed={on} onClick={() => toggle(c.id)} className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border p-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50", on && "border-primary bg-primary/5")}>
                      <span className={cn("grid size-5 shrink-0 place-items-center rounded-md border-2", on && "border-primary bg-primary text-primary-foreground")}>{on ? <Check className="size-3.5" aria-hidden /> : null}</span>
                      <span className="size-10 shrink-0"><LazyQr data={itemData(c)} style={c.style} size={80} className="rounded-md" label="" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{TYPES[c.type].label} · {c.mode === "dynamic" ? "Dynamic" : "Static"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {shown.length === 0 ? <li className="p-3 text-center text-sm text-muted-foreground">No codes match “{q}”.</li> : null}
              {shown.length > ROWS ? <li className="p-2 text-center text-xs text-muted-foreground">Showing {ROWS} of {shown.length}. Search to narrow the list; “Select all” still includes every match.</li> : null}
            </ul>
          </>
        )}
        {result?.failed.length ? (
          <div role="alert" className="max-h-32 overflow-y-auto rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
            <p className="font-medium">{result.failed.length} could not be updated (still selected so you can retry):</p>
            <ul>{result.failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}</ul>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" className={TAP} disabled={busy} onClick={close}>{result && !result.failed.length ? "Done" : "Cancel"}</Button>
          <Button className={TAP} disabled={busy || offline || picked.size === 0} onClick={() => void apply()}>
            {busy ? <Loader2 className="animate-spin" /> : null} Apply to {picked.size || ""} {picked.size === 1 ? "code" : "codes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
