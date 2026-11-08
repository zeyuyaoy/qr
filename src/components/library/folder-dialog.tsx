"use client";
import { Check, Folder as FolderIcon, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { ErrorNotice, errMsg, TAP } from "./common";
import type { FolderWithCount } from "./use-library";

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"];

function ColorChoice({ value, onChange, name }: { value: string | null; onChange: (c: string | null) => void; name: string }) {
  const opts: (string | null)[] = [null, ...COLORS];
  return (
    <div role="group" aria-label={`Colour for ${name}`} className="flex flex-wrap gap-1">
      {opts.map((c) => (
        <button
          key={c ?? "none"}
          type="button"
          aria-pressed={value === c}
          aria-label={c ? `Colour ${c}` : "No colour"}
          onClick={() => onChange(c)}
          className="grid size-9 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className={cn("grid size-6 place-items-center rounded-full border", value === c && "ring-2 ring-foreground ring-offset-2 ring-offset-popover")} style={c ? { background: c, borderColor: c } : undefined}>
            {value === c && c ? <Check className="size-3.5 text-white" aria-hidden /> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function FolderRow({ folder, onChanged, disabled }: { folder: FolderWithCount; onChanged: () => void; disabled: boolean }) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState(folder.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(ok);
      setMode("view");
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "edit")
    return (
      <li className="grid gap-2 rounded-xl border p-2.5">
        <label className="grid gap-1 text-sm font-medium">
          Folder name
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-10" autoFocus />
        </label>
        <ColorChoice value={color} onChange={setColor} name={folder.name} />
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button className={TAP} disabled={busy || !name.trim()} onClick={() => void run(() => api.folders.update(folder.id, name.trim(), color), "Folder updated")}>
            {busy ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
          <Button variant="outline" className={TAP} disabled={busy} onClick={() => { setMode("view"); setName(folder.name); setColor(folder.color); setError(null); }}>
            Cancel
          </Button>
        </div>
      </li>
    );

  return (
    <li className="rounded-xl border p-2.5">
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-3 shrink-0 rounded-full border" style={folder.color ? { background: folder.color, borderColor: folder.color } : undefined} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{folder.name}</p>
          <p className="text-xs text-muted-foreground">{folder.count} {folder.count === 1 ? "code" : "codes"}</p>
        </div>
        <Button variant="ghost" size="icon" className="tap" aria-label={`Edit folder ${folder.name}`} disabled={disabled} onClick={() => setMode("edit")}><Pencil /></Button>
        <Button variant="ghost" size="icon" className="tap" aria-label={`Delete folder ${folder.name}`} disabled={disabled} onClick={() => setMode(mode === "delete" ? "view" : "delete")}><Trash2 /></Button>
      </div>
      {mode === "delete" ? (
        <div className="mt-2 grid gap-2 rounded-lg bg-destructive/10 p-2.5 text-sm" role="group" aria-label={`Confirm deleting ${folder.name}`}>
          <p>
            Delete this folder? Its {folder.count} {folder.count === 1 ? "code stays" : "codes stay"} in your library and become unfiled. No codes are deleted.
          </p>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button variant="destructive" className={TAP} disabled={busy} onClick={() => void run(() => api.folders.remove(folder.id), "Folder deleted")}>
              {busy ? <Loader2 className="animate-spin" /> : null} Delete folder
            </Button>
            <Button variant="outline" className={TAP} disabled={busy} onClick={() => setMode("view")}>Keep</Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Create, rename, recolour and delete folders. Deleting a folder un-files its codes; it never deletes them. */
export function FolderDialog({ open, onOpenChange, offline, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; offline: boolean; onChanged: () => void }) {
  const [folders, setFolders] = useState<FolderWithCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.folders.list().then(
      (l) => alive && (setFolders(l), setError(null)),
      (e) => alive && setError(errMsg(e)),
    );
    return () => {
      alive = false;
    };
  }, [open, tick]);

  const changed = () => {
    load();
    onChanged();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      await api.folders.create(name.trim(), color);
      toast.success("Folder created");
      setName("");
      setColor(null);
      changed();
    } catch (err) {
      setCreateError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage folders</DialogTitle>
          <DialogDescription>Folders organise your library. Deleting a folder never deletes the codes inside it.</DialogDescription>
        </DialogHeader>
        {offline ? <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">Folders can only be changed while online.</p> : null}
        <form onSubmit={create} className="grid gap-2 rounded-xl bg-muted/50 p-2.5">
          <label className="grid gap-1 text-sm font-medium">
            New folder
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Menus" className="h-10" disabled={offline} />
          </label>
          <ColorChoice value={color} onChange={setColor} name="the new folder" />
          {createError ? <p role="alert" className="text-xs text-destructive">{createError}</p> : null}
          <Button type="submit" className={TAP} disabled={offline || busy || !name.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Create folder
          </Button>
        </form>
        {error ? (
          <ErrorNotice title="Could not load folders" message={error} onRetry={load} />
        ) : !folders ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading folders…</p>
        ) : folders.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><FolderIcon className="size-4" /> No folders yet.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Folders">
            {folders.map((f) => <FolderRow key={f.id} folder={f} disabled={offline} onChanged={changed} />)}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
