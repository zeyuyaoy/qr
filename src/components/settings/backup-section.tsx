"use client";
import { CheckCircle2, CircleAlert, Download, Loader2, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type BackupRun, type StatusData } from "@/lib/client/api";
import { formatDateTime, useAsync, useOnline, useStatus } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Section } from "./field";
import { IndexMaintenance } from "./index-maintenance";
import { RestorePanel } from "./restore-panel";

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function Freshness({ state, ageHours, at, tz }: { state: "ok" | "stale" | "never" | "unconfigured"; ageHours: number | null; at: string | null; tz: string }) {
  const age = ageHours === null ? "" : ageHours < 1 ? "less than an hour ago" : ageHours < 48 ? `${Math.round(ageHours)} hours ago` : `${Math.round(ageHours / 24)} days ago`;
  const map = {
    ok: { Icon: CheckCircle2, tone: "border-emerald-500/40 bg-emerald-500/10", title: "Backups are up to date", body: `Last successful backup ${age} (${formatDateTime(at, tz)}).` },
    stale: { Icon: TriangleAlert, tone: "border-amber-500/40 bg-amber-500/10", title: "Backups are stale", body: `The last successful backup was ${age} (${formatDateTime(at, tz)}). The daily job may be failing. Back up now and check the history below.` },
    never: { Icon: CircleAlert, tone: "border-amber-500/40 bg-amber-500/10", title: "No backup has completed yet", body: "Backup is configured but nothing has been saved. Press Back up now to create the first snapshot." },
    unconfigured: { Icon: ShieldAlert, tone: "border-destructive/40 bg-destructive/10", title: "Backups are off", body: "" },
  }[state];
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-xl border p-3 text-sm", map.tone)}>
      <map.Icon className="mt-0.5 size-5 shrink-0" />
      <div><p className="font-medium">{map.title}</p>{map.body ? <p className="text-muted-foreground">{map.body}</p> : null}</div>
    </div>
  );
}

const ENV: { name: string; group: "backup" | "cron"; what: string }[] = [
  { name: "BACKUP_GITHUB_REPO", group: "backup", what: "a private GitHub repository, as owner/name" },
  { name: "BACKUP_GITHUB_TOKEN", group: "backup", what: "a fine-grained token limited to that repository with Contents read and write" },
  { name: "BACKUP_ENCRYPTION_KEY", group: "backup", what: "a 32-byte key, base64 encoded (generate with: openssl rand -base64 32)" },
  { name: "CRON_SECRET", group: "cron", what: "a long random string so the daily scheduled job can run the backup" },
];

function Unconfigured({ config }: { config?: StatusData["config"] }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border-2 border-destructive/60 bg-destructive/10 p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-6 shrink-0 text-destructive" />
        <div className="space-y-1 text-sm">
          <p className="text-base font-semibold">Your saved data is NOT protected</p>
          <p>Backups are not configured. Redis Cloud Free has no durable persistence, so if the database is reset, every code, folder and dynamic link is lost with no way to bring it back. Printed dynamic codes would stop working.</p>
        </div>
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Set these environment variables on the server, then redeploy:</p>
        <ul className="space-y-1.5 text-sm">
          {ENV.map((v) => {
            const flag = { BACKUP_GITHUB_REPO: "githubRepo", BACKUP_GITHUB_TOKEN: "githubToken", BACKUP_ENCRYPTION_KEY: "backupKey", CRON_SECRET: "cron" } as const;
            const ok = config?.[flag[v.name as keyof typeof flag]] ?? null;
            return (
              <li key={v.name} className="flex flex-wrap items-baseline gap-x-2">
                <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-xs">{v.name}</code>
                <Badge variant={ok ? "secondary" : "destructive"}>{ok === null ? "unknown" : ok ? "set" : "missing"}</Badge>
                <span className="text-muted-foreground">{v.what}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">BACKUP_GITHUB_BRANCH is optional and defaults to main. Encrypted downloads need the backup key; scheduled GitHub snapshots also need the repository, token and cron secret.</p>
      </div>
    </div>
  );
}

function Outcome({ run, tz }: { run: BackupRun; tz: string }) {
  const bad = run.outcome === "failed";
  const text = { created: `New snapshot saved${run.name ? ` (${run.name})` : ""}.`, unchanged: "Nothing changed since the last snapshot, so no new snapshot was needed.", skipped: "Backup was skipped.", failed: "Backup failed." }[run.outcome];
  return (
    <p role={bad ? "alert" : "status"} className={cn("rounded-lg border p-3 text-sm", bad ? "border-destructive/40 bg-destructive/10" : "bg-muted/50")}>
      <strong>{formatDateTime(run.at, tz)}:</strong> {text} {run.records !== undefined && run.outcome !== "failed" ? `${run.records} codes. ` : ""}{run.error ? <span>{run.error}</span> : null}
    </p>
  );
}

export function BackupSection({ timezone }: { timezone: string }) {
  const online = useOnline();
  const status = useStatus();
  const info = useAsync(() => api.backup.info(), []);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<BackupRun | null>(null);
  const [selected, setSelected] = useState("");
  const data = info.data;
  const cfg = status.data?.config;
  const configured = data?.configured ?? cfg?.backup ?? false;

  const backupNow = async () => {
    setRunning(true);
    try {
      const run = await api.backup.run();
      setLast(run);
      if (run.outcome === "failed") toast.error(run.error ?? "Backup failed");
      else toast.success(run.outcome === "created" ? "Backup created" : run.outcome === "unchanged" ? "Already up to date" : "Backup skipped");
      void info.refresh();
      void status.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Section id="backup" title="Backup and recovery" description="Encrypted snapshots of your library are stored in a private GitHub repository once a day and whenever you press Back up now.">
      {info.loading && !data ? (
        <div aria-busy="true" aria-label="Loading backup status" className="space-y-2"><div className="h-14 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></div>
      ) : info.error && !data ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>Could not load backup status: {info.error.message}</p>
          <Button variant="outline" className="tap" onClick={() => void info.refresh()}><RefreshCw /> Try again</Button>
        </div>
      ) : data ? (
        <>
          {!data.configured ? <Unconfigured config={cfg} /> : <Freshness state={data.freshness.state} ageHours={data.freshness.ageHours} at={data.freshness.lastSuccessAt} tz={timezone} />}
          {data.configured && cfg && !cfg.cron && <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><code className="font-mono text-xs">CRON_SECRET</code> is not set, so the daily scheduled backup cannot run. Manual backups still work.</p>}

          <div className="flex flex-wrap gap-2">
            <Button className="tap" onClick={() => void backupNow()} disabled={!configured || running || !online}>
              {running ? <Loader2 className="animate-spin" /> : <RefreshCw />} Back up now
            </Button>
            {cfg?.backupKey && online ? (
              <a href={api.backup.downloadUrl} target="_blank" rel="noopener" className="tap inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"><Download className="size-4" /> Download encrypted export</a>
            ) : (
              <Button variant="outline" className="tap" disabled><Download /> Download encrypted export</Button>
            )}
          </div>
          {!online && <p className="text-xs text-muted-foreground">Backup actions need a connection.</p>}
          {last && <Outcome run={last} tz={timezone} />}
          {data.listError && <p role="alert" className="text-sm text-destructive">Could not list snapshots from GitHub: {data.listError}</p>}

          <p className="text-sm text-muted-foreground">
            Be realistic about what this gives you: snapshots reduce the chance of losing your library but do not remove it. Anything created or changed since the last snapshot cannot be recovered from it, and with a daily schedule that can be up to a day of work. Press Back up now after important changes. The exported file and the GitHub snapshots are encrypted, and are useless without your BACKUP_ENCRYPTION_KEY, so keep a copy of that key somewhere safe.
          </p>

          <div>
            <h3 className="mb-2 text-sm font-medium">History</h3>
            {data.status.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No backup runs recorded yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <caption className="sr-only">Recent backup runs</caption>
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr><th scope="col" className="px-3 py-2 font-medium">When</th><th scope="col" className="px-3 py-2 font-medium">Trigger</th><th scope="col" className="px-3 py-2 font-medium">Result</th><th scope="col" className="px-3 py-2 font-medium">Details</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.status.history.map((h) => (
                      <tr key={h.at + h.trigger}>
                        <td className="whitespace-nowrap px-3 py-2">{formatDateTime(h.at, timezone)}</td>
                        <td className="px-3 py-2 capitalize">{h.trigger}</td>
                        <td className="px-3 py-2"><Badge variant={h.outcome === "failed" ? "destructive" : h.outcome === "created" ? "default" : "secondary"}>{h.outcome}</Badge></td>
                        <td className="px-3 py-2 text-muted-foreground">{h.error ?? (h.records !== undefined ? `${h.records} codes${h.bytes ? `, ${kb(h.bytes)}` : ""}${h.pruned ? `, ${h.pruned} old pruned` : ""}` : "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Snapshots on GitHub</h3>
            {data.snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{configured ? "No snapshots found in the repository yet." : "Configure backups to see snapshots here."}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {data.snapshots.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{formatDateTime(s.createdAt, timezone)}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.name} · {kb(s.size)}</p>
                    </div>
                    <Button variant="outline" className="tap" disabled={!online} onClick={() => { setSelected(s.name); document.getElementById("restore-title")?.scrollIntoView({ block: "start" }); }}>Restore…</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <RestorePanel snapshots={data.snapshots} selected={selected} onSelect={setSelected} timezone={timezone} onApplied={() => { void info.refresh(); void status.refresh(); }} />
          <IndexMaintenance />
        </>
      ) : null}
    </Section>
  );
}
