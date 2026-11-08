"use client";
import { Archive, ArchiveRestore, FolderInput, Loader2, MoreHorizontal, Palette, Pin, PinOff, Power, PowerOff, Printer, Star, StarOff, Tag, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, NativeSelect, TextField } from "@/components/ui/field";
import { api, type BatchAction } from "@/lib/client/api";
import { useAsync } from "@/lib/client/hooks";
import { tagSchema } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { ErrorNotice, TAP } from "./common";
import type { Tab } from "./filters";
import type { FolderWithCount } from "./use-library";

export type ValueKind = "tag-add" | "tag-remove" | "move-folder" | "apply-template";
const MI = "min-h-10 md:min-h-8";

const TITLES: Record<ValueKind, { title: string; action: string }> = {
  "tag-add": { title: "Add a tag", action: "Add tag" },
  "tag-remove": { title: "Remove a tag", action: "Remove tag" },
  "move-folder": { title: "Move to folder", action: "Move" },
  "apply-template": { title: "Apply a template", action: "Apply template" },
};

/** Collects the extra value some bulk actions need, then hands (action, value) back. */
function ValueDialog({ kind, count, allTags, selectedTags, folders, onClose, onSubmit }: { kind: ValueKind; count: number; allTags: string[]; selectedTags: string[]; folders: FolderWithCount[]; onClose: () => void; onSubmit: (action: BatchAction, value: string | null) => void }) {
  const [text, setText] = useState("");
  const [pick, setPick] = useState("");
  const templates = useAsync(() => (kind === "apply-template" ? api.templates.list() : Promise.resolve([])), [kind]);
  const parsedTag = kind === "tag-add" ? tagSchema.safeParse(text) : null;
  const tagError = parsedTag && text && !parsedTag.success ? (parsedTag.error.issues[0]?.message ?? "Invalid tag") : undefined;

  let body: React.ReactNode;
  let ready = false;
  let value: string | null = null;
  if (kind === "tag-add") {
    ready = Boolean(parsedTag?.success);
    value = parsedTag?.success ? parsedTag.data : null;
    body = (
      <>
        <TextField label="Tag" value={text} onChange={(e) => setText(e.target.value)} list="library-tag-suggestions" maxLength={32} autoFocus error={tagError} hint="Letters, digits, spaces, - and _. Stored in lowercase." />
        <datalist id="library-tag-suggestions">
          {allTags.map((t) => <option key={t} value={t} />)}
        </datalist>
      </>
    );
  } else if (kind === "tag-remove") {
    ready = Boolean(pick);
    value = pick;
    body = selectedTags.length ? (
      <Field label="Tag to remove">{(a) => <NativeSelect {...a} value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Choose a tag…</option>
        {selectedTags.map((t) => <option key={t} value={t}>{t}</option>)}
      </NativeSelect>}</Field>
    ) : (
      <p className="text-sm text-muted-foreground">None of the selected codes have tags.</p>
    );
  } else if (kind === "move-folder") {
    ready = true;
    value = pick || null;
    body = (
      <Field label="Folder">{(a) => <NativeSelect {...a} value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">No folder</option>
        {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </NativeSelect>}</Field>
    );
  } else {
    ready = Boolean(pick);
    value = pick;
    body = templates.error ? (
      <ErrorNotice title="Could not load templates" message={templates.error.message} onRetry={() => void templates.refresh()} />
    ) : !templates.data ? (
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading templates…</p>
    ) : templates.data.length === 0 ? (
      <p className="text-sm text-muted-foreground">You have no saved templates yet. Create one on the Templates page (built-in presets can be saved there too).</p>
    ) : (
      <Field label="Template" hint="Replaces the style of every selected code. Content and links are not changed.">{(a) => <NativeSelect {...a} value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Choose a template…</option>
        {templates.data!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </NativeSelect>}</Field>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[kind].title}</DialogTitle>
          <DialogDescription>{count} selected {count === 1 ? "code" : "codes"}.</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button variant="outline" className={TAP} onClick={onClose}>Cancel</Button>
          <Button className={TAP} disabled={!ready} onClick={() => onSubmit(kind, value)}>{TITLES[kind].action}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sticky bulk-action bar shown in selection mode. */
export function SelectionBar({
  tab,
  count,
  total,
  offline,
  busy,
  folders,
  allTags,
  selectedTags,
  onSelectAll,
  onClear,
  onRun,
  onPrint,
}: {
  tab: Tab;
  count: number;
  total: number;
  offline: boolean;
  busy: boolean;
  folders: FolderWithCount[];
  allTags: string[];
  selectedTags: string[];
  onSelectAll: () => void;
  onClear: () => void;
  onRun: (action: BatchAction, value?: string | null) => void;
  onPrint: () => void;
}) {
  const [dialog, setDialog] = useState<ValueKind | null>(null);
  const none = count === 0;
  const server = tab !== "pending";
  const off = offline || busy || none;
  const run = (a: BatchAction) => () => onRun(a);
  return (
    <>
      <div role="region" aria-label="Bulk actions" className="sticky bottom-[4.75rem] z-30 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border bg-popover/95 p-2 text-popover-foreground shadow-lg backdrop-blur md:bottom-4">
        <div className="flex min-w-0 flex-1 basis-40 flex-wrap items-center gap-x-2">
          <span className="px-1 text-sm font-medium" aria-live="polite">{count} selected</span>
          <Button variant="link" className="h-auto min-h-8 p-0" onClick={onSelectAll} disabled={count === total}>Select all {total}</Button>
          <Button variant="link" className="h-auto min-h-8 p-0" onClick={onClear} disabled={none}>Clear</Button>
        </div>
        {busy ? <Loader2 className="size-4 animate-spin" aria-label="Working" /> : null}
        {server && tab !== "trashed" ? (
          <>
            {tab === "archived" ? (
              <Button variant="outline" className={TAP} disabled={off} onClick={run("restore")}><ArchiveRestore /> Restore</Button>
            ) : (
              <Button variant="outline" className={TAP} disabled={off} onClick={run("archive")}><Archive /> Archive</Button>
            )}
            <Button variant="outline" className={TAP} disabled={off} onClick={run("trash")}><Trash2 /> Trash</Button>
          </>
        ) : null}
        {tab === "trashed" ? (
          <>
            <Button variant="outline" className={TAP} disabled={off} onClick={run("restore")}><ArchiveRestore /> Restore</Button>
            <Button variant="destructive" className={TAP} disabled={off} onClick={run("purge")}><Trash2 /> Delete forever</Button>
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className={TAP} disabled={none} />}>
            <MoreHorizontal /> More
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-56">
            {server ? (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuItem className={MI} disabled={off} onClick={run("favorite")}><Star /> Favorite</DropdownMenuItem>
                  <DropdownMenuItem className={MI} disabled={off} onClick={run("unfavorite")}><StarOff /> Remove favorite</DropdownMenuItem>
                  <DropdownMenuItem className={MI} disabled={off} onClick={run("pin")}><Pin /> Pin to top</DropdownMenuItem>
                  <DropdownMenuItem className={MI} disabled={off} onClick={run("unpin")}><PinOff /> Unpin</DropdownMenuItem>
                  <DropdownMenuItem className={MI} disabled={off} onClick={run("enable")}><Power /> Enable links</DropdownMenuItem>
                  <DropdownMenuItem className={MI} disabled={off} onClick={run("disable")}><PowerOff /> Pause links</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className={MI} disabled={off} onClick={() => setDialog("tag-add")}><Tag /> Add tag…</DropdownMenuItem>
                  <DropdownMenuItem className={MI} disabled={off} onClick={() => setDialog("tag-remove")}><Tags /> Remove tag…</DropdownMenuItem>
                  <DropdownMenuItem className={MI} disabled={off} onClick={() => setDialog("move-folder")}><FolderInput /> Move to folder…</DropdownMenuItem>
                  <DropdownMenuItem className={MI} disabled={off} onClick={() => setDialog("apply-template")}><Palette /> Apply template…</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuGroup>
              <DropdownMenuItem className={MI} disabled={busy || none} onClick={onPrint}><Printer /> Print selected</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {offline && server ? <p className={cn("basis-full px-1 text-xs text-muted-foreground")}>You&apos;re offline. Changes to codes need a connection; printing still works.</p> : null}
      </div>
      {dialog ? (
        <ValueDialog
          kind={dialog}
          count={count}
          allTags={allTags}
          selectedTags={selectedTags}
          folders={folders}
          onClose={() => setDialog(null)}
          onSubmit={(a, v) => {
            setDialog(null);
            onRun(a, v);
          }}
        />
      ) : null}
    </>
  );
}
