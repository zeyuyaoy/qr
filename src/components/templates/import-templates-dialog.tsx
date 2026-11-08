"use client";
import { FileUp, Loader2, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import type { Template } from "@/lib/schema";
import { errMsg, readTextFile, TAP } from "@/components/library/common";
import { LOGO_NOTE, parseTemplateFile, type ParsedTemplates } from "./templates-io";

/** Choose a templates file → validate every style → create the valid ones. Invalid entries are listed by name. */
export function ImportTemplatesDialog({ open, existingNames, offline, onClose, onImported }: { open: boolean; existingNames: string[]; offline: boolean; onClose: () => void; onImported: (created: Template[]) => void }) {
  const fileId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedTemplates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ label: string; error: string }[]>([]);
  const [done, setDone] = useState<number | null>(null);

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setError(null);
    setFailed([]);
    setDone(null);
    if (input.current) input.current.value = "";
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setParsed(null);
    setFailed([]);
    setDone(null);
    try {
      const p = parseTemplateFile(await readTextFile(file, 5 * 1024 * 1024));
      setFileName(file.name);
      setParsed(p);
    } catch (e) {
      setFileName(null);
      setError(errMsg(e));
    }
  };

  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    setFailed([]);
    const created: Template[] = [];
    const bad: { label: string; error: string }[] = [];
    for (const t of parsed.valid) {
      try {
        created.push(await api.templates.create(t.name, t.style));
      } catch (e) {
        bad.push({ label: t.name, error: errMsg(e) });
      }
    }
    setBusy(false);
    setFailed(bad);
    setDone(created.length);
    if (created.length) onImported(created);
    if (bad.length) toast.warning(`Imported ${created.length}; ${bad.length} failed`);
    else toast.success(`Imported ${created.length} ${created.length === 1 ? "template" : "templates"}`);
  };

  const dupes = parsed ? parsed.valid.filter((t) => existingNames.includes(t.name)).length : 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import templates</DialogTitle>
          <DialogDescription>Choose a templates file exported from QR Studio. Every style is checked before anything is created.</DialogDescription>
        </DialogHeader>
        {offline ? <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">Importing needs a connection.</p> : null}
        <div className="grid gap-1.5">
          <label htmlFor={fileId} className="text-sm font-medium">Templates file (.json)</label>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} id={fileId} type="file" accept="application/json,.json" className="sr-only" disabled={busy || offline || done !== null} onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button variant="outline" className={TAP} disabled={busy || offline || done !== null} onClick={() => input.current?.click()}>
              <FileUp /> {fileName ? "Choose another file" : "Choose file"}
            </Button>
            <span className="min-w-0 truncate text-sm text-muted-foreground">{fileName ?? "No file chosen"}</span>
          </div>
        </div>
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        {parsed && done === null ? (
          <div className="grid gap-2 text-sm" aria-live="polite">
            <p><strong>{parsed.valid.length}</strong> valid {parsed.valid.length === 1 ? "template" : "templates"} ready to import{parsed.invalid.length ? <>, <strong className="text-destructive">{parsed.invalid.length}</strong> invalid and skipped</> : null}.</p>
            {dupes ? <p className="text-muted-foreground">{dupes} {dupes === 1 ? "has" : "have"} the same name as an existing template; they&apos;ll be added alongside it.</p> : null}
            {parsed.withLogo ? (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-amber-900 dark:text-amber-200"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {parsed.withLogo} use a logo. {LOGO_NOTE}</p>
            ) : null}
            {parsed.invalid.length ? (
              <ul className="max-h-40 overflow-y-auto rounded-lg border p-2 text-xs" aria-label="Invalid templates">
                {parsed.invalid.map((x, i) => <li key={i}><span className="font-medium">{x.label}</span>: <span className="text-destructive">{x.error}</span></li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
        {done !== null ? (
          <div className="grid gap-2 text-sm" aria-live="polite">
            <p>Imported <strong>{done}</strong> {done === 1 ? "template" : "templates"}.</p>
            {failed.length ? (
              <ul className="max-h-40 overflow-y-auto rounded-lg bg-destructive/10 p-2 text-xs text-destructive" role="alert">
                {failed.map((x, i) => <li key={i}><span className="font-medium">{x.label}</span>: {x.error}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" className={TAP} disabled={busy} onClick={close}>{done !== null ? "Close" : "Cancel"}</Button>
          {done === null ? (
            <Button className={TAP} disabled={busy || offline || !parsed || parsed.valid.length === 0} onClick={() => void run()}>
              {busy ? <Loader2 className="animate-spin" /> : null} Import {parsed?.valid.length ? parsed.valid.length : ""}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
