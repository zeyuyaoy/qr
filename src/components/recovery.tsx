"use client";
import { DatabaseBackup, FileUp, HardDrive, Loader2, PlayCircle, ShieldAlert } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, type RestoreReport, type StatusData } from "@/lib/client/api";
import { library } from "@/lib/client/offline";
import { LIBRARY_FORMAT } from "@/lib/library-format";

/**
 * Shown INSTEAD of the app when Redis answers but has no initialisation marker — i.e. a fresh install or
 * total data loss (Redis Cloud Free has no durable persistence). Writes are blocked server-side until the
 * owner picks a way forward, so a wipe can never be mistaken for "an empty library".
 */
export function Recovery({ status, onDone }: { status: StatusData; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ title: string; r: RestoreReport; apply: () => Promise<void> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = status.recovery.backup;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const previewRestore = (title: string, source: { github: string } | { text: string }) =>
    run(title, async () => {
      const opts = { dryRun: true, mode: "merge" as const, prefer: "newer" as const };
      const dry = await api.backup.restore({ source, ...opts });
      setReport({
        title,
        r: dry.report,
        apply: async () => {
          await api.backup.restore({ source, ...opts, dryRun: false });
          toast.success("Library restored");
          onDone();
        },
      });
    });

  const fromDeviceCache = () =>
    run("cache", async () => {
      const { items } = await library.read();
      if (!items.length) throw new Error("This device has no cached library");
      const data = { format: LIBRARY_FORMAT, version: 1, exportedAt: new Date().toISOString(), codes: items, folders: [], templates: [] };
      const dry = await api.library.import(data, { dryRun: true, policy: "skip" });
      if (!window.confirm(`Re-create ${dry.created} code(s) from this device's cache? (${dry.invalid.length} invalid, link passwords cannot be restored)`)) return;
      await api.admin.init();
      await api.library.import(data, { dryRun: false, policy: "skip" });
      toast.success(`Restored ${dry.created} codes from this device`);
      onDone();
    });

  return (
    <section className="mx-auto max-w-xl space-y-4" aria-labelledby="rec-title">
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <h2 id="rec-title" className="font-semibold">Library not initialised</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Redis is reachable but this library has no initialisation record. Either this is the first run, or the database lost its data
              (Redis Cloud Free has no durable persistence). Saving is paused so nothing is overwritten. Dynamic links return “temporarily unavailable” until this is resolved.
            </p>
          </div>
        </div>
      </div>

      {report ? (
        <div className="space-y-3 rounded-2xl border p-5">
          <h3 className="font-medium">Dry run — {report.title}</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Snapshot taken</dt><dd>{new Date(report.r.snapshotCreatedAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Codes to create</dt><dd>{report.r.codes.create}</dd>
            <dt className="text-muted-foreground">Folders / templates</dt><dd>{report.r.folders} / {report.r.templates}</dd>
            <dt className="text-muted-foreground">Slug conflicts</dt><dd>{report.r.codes.slugConflicts}</dd>
            <dt className="text-muted-foreground">Invalid records</dt><dd>{report.r.codes.invalid}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">Changes made after this snapshot was taken cannot be recovered from it.</p>
          <div className="flex gap-2">
            <Button disabled={!!busy} onClick={() => run("apply", report.apply)}>{busy === "apply" ? <Loader2 className="animate-spin" /> : null} Restore now</Button>
            <Button variant="outline" onClick={() => setReport(null)}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <Option icon={<DatabaseBackup />} title="Restore the latest backup" detail={latest ? `Snapshot from ${new Date(latest.createdAt).toLocaleString()}` : status.recovery.backupError ?? (status.backup.configured ? "No snapshots found in the backup repository" : "Backups are not configured")} disabled={!latest || !!busy} onClick={() => previewRestore("latest GitHub backup", { github: latest!.name })} busy={busy === "latest GitHub backup"} />
          <Option icon={<FileUp />} title="Restore from an encrypted backup file" detail="Choose a .qrbackup.json exported earlier (needs BACKUP_ENCRYPTION_KEY on the server)" disabled={!!busy} onClick={() => fileRef.current?.click()} busy={false} />
          <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" aria-label="Encrypted backup file" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) await previewRestore(f.name, { text: await f.text() });
          }} />
          <Option icon={<HardDrive />} title="Rebuild from this device's cache" detail="Uses the copy of your library cached in this browser (no link passwords)" disabled={!!busy} onClick={fromDeviceCache} busy={busy === "cache"} />
          <Option icon={<PlayCircle />} title="Start with an empty library" detail="First run, or you accept the loss. Existing printed dynamic codes will say “not found”." disabled={!!busy} onClick={() => run("init", async () => { if (window.confirm("Start with an empty library?")) { await api.admin.init(); onDone(); } })} busy={busy === "init"} />
        </div>
      )}
    </section>
  );
}

function Option({ icon, title, detail, onClick, disabled, busy }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void; disabled: boolean; busy: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="tap flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
      <span className="mt-0.5 text-muted-foreground">{busy ? <Loader2 className="animate-spin" /> : icon}</span>
      <span><span className="block font-medium">{title}</span><span className="block text-sm text-muted-foreground">{detail}</span></span>
    </button>
  );
}
