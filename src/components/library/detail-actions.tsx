"use client";
import { Archive, ArchiveRestore, Loader2, Palette, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/field";
import { api } from "@/lib/client/api";
import { useAsync } from "@/lib/client/hooks";
import { library, type CachedView } from "@/lib/client/offline";
import { ConfirmDialog, ErrorNotice, errMsg, TAP } from "./common";
import { applyLocal, runBatch } from "./library-actions";

/** Pick a saved template and restyle this one code. Content, links and settings are untouched. */
export function ApplyTemplate({ id, offline, onApplied }: { id: string; offline: boolean; onApplied: () => void }) {
  const templates = useAsync(() => api.templates.list(), []);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const list = templates.data ?? [];

  const apply = async () => {
    setBusy(true);
    try {
      const [r] = await runBatch([id], "apply-template", pick);
      if (!r?.ok) throw new Error(r?.error ?? "Could not apply the template");
      toast.success("Template applied");
      setPick("");
      onApplied();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="apply-template-h" className="rounded-2xl border bg-card p-4">
      <h2 id="apply-template-h" className="flex items-center gap-2 text-base font-medium"><Palette className="size-4" aria-hidden /> Apply a template</h2>
      <p className="mt-1 text-sm text-muted-foreground">Restyle this code with one of your saved templates. Unsaved changes in the editor above are replaced.</p>
      <div className="mt-3">
        {templates.error && !templates.data ? (
          <ErrorNotice title="Could not load templates" message={templates.error.message} onRetry={() => void templates.refresh()} />
        ) : !templates.data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading templates…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no saved templates yet. Create one on the Templates page.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Template" className="min-w-0 flex-1 basis-56">{(a) => <NativeSelect {...a} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a template…</option>
              {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>}</Field>
            <Button className={TAP} disabled={!pick || busy || offline} onClick={() => void apply()}>
              {busy ? <Loader2 className="animate-spin" /> : null} Apply
            </Button>
          </div>
        )}
        {offline ? <p className="mt-2 text-xs text-muted-foreground">Applying a template needs a connection.</p> : null}
      </div>
    </section>
  );
}

/** Archive / trash / delete forever, each behind a confirmation where it can't be undone. */
export function DangerZone({ view, offline, onChanged }: { view: CachedView; offline: boolean; onChanged: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"trash" | "purge" | null>(null);

  const run = async (action: "archive" | "restore" | "trash" | "purge", done: string, leave = false) => {
    setBusy(action);
    try {
      const [r] = await runBatch([view.id], action);
      if (!r?.ok) throw new Error(r?.error ?? "That did not work");
      if (action === "purge") await library.remove(view.id);
      else await library.upsert(applyLocal(view, action));
      toast.success(done);
      if (leave) router.push("/library");
      else onChanged();
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="danger-h" className="rounded-2xl border border-destructive/30 p-4">
      <h2 id="danger-h" className="text-base font-medium text-destructive">Danger zone</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {view.status === "trashed"
          ? "This code is in the trash and its link no longer redirects. Restore it, or delete it forever."
          : view.status === "archived"
            ? "This code is archived. Restore it to bring it back to your library."
            : "Archiving keeps the code (and its link) but tidies it away. The trash can be emptied later."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {view.status === "active" ? (
          <Button variant="outline" className={TAP} disabled={offline || busy !== null} onClick={() => void run("archive", "Archived").catch(() => undefined)}>
            {busy === "archive" ? <Loader2 className="animate-spin" /> : <Archive />} Archive
          </Button>
        ) : (
          <Button variant="outline" className={TAP} disabled={offline || busy !== null} onClick={() => void run("restore", "Restored").catch(() => undefined)}>
            {busy === "restore" ? <Loader2 className="animate-spin" /> : <ArchiveRestore />} Restore
          </Button>
        )}
        {view.status !== "trashed" ? (
          <Button variant="destructive" className={TAP} disabled={offline || busy !== null} onClick={() => setConfirm("trash")}>
            <Trash2 /> Move to trash
          </Button>
        ) : (
          <Button variant="destructive" className={TAP} disabled={offline || busy !== null} onClick={() => setConfirm("purge")}>
            <Trash2 /> Delete forever
          </Button>
        )}
      </div>
      {offline ? <p className="mt-2 text-xs text-muted-foreground">These actions need a connection.</p> : null}

      <ConfirmDialog
        open={confirm === "trash"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Move this code to the trash?"
        description={view.mode === "dynamic" ? "Its short link will stop redirecting until you restore it. You can restore it from the Trash tab." : "You can restore it from the Trash tab."}
        confirmLabel="Move to trash"
        onConfirm={() => run("trash", "Moved to trash", true)}
      />
      <ConfirmDialog
        open={confirm === "purge"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this code forever?"
        description="This cannot be undone. The code, its short link and its scan count are removed permanently. Printed copies of a dynamic code will stop working."
        confirmLabel="Delete forever"
        onConfirm={() => run("purge", "Deleted forever", true)}
      />
    </section>
  );
}
