"use client";
import { Database, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useStatus } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Section } from "./field";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

const WHERE: { title: string; body: string }[] = [
  { title: "Redis (your database)", body: "Code records and settings, the hashes of link passwords (never the passwords themselves), and aggregate scan counters. Wi-Fi and contact-card payloads are sealed with an encryption key before they are written." },
  { title: "This browser (IndexedDB)", body: "Unsaved drafts, a cached copy of your library so it opens offline, and the queue of changes made while offline. It is wiped when you sign out." },
  { title: "GitHub (optional backups)", body: "Encrypted snapshots of everything in Redis. GitHub only ever sees ciphertext; the key stays with your server." },
];

export function DataSection() {
  const { data, error, loading, refresh } = useStatus();
  const used = data?.storage.usedBytes ?? null;
  const max = data?.storage.maxBytes ?? null;
  const pct = used !== null && max ? Math.min(100, Math.round((used / max) * 100)) : null;
  return (
    <Section id="data" title="Data and storage" description="Where your information lives and how much room is left.">
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div className="space-y-1.5">
          <p className="font-semibold">Redis Cloud Free has no TLS and no durable persistence</p>
          <p>Traffic between this app and Redis is not encrypted on the free tier, and the free tier can lose data if the instance is restarted or reset. Link passwords are hashed and Wi-Fi and contact codes are sealed, but destinations and metadata cross the network in clear text.</p>
          {data?.security.warning && data.security.warning.length > 0 && <p className="text-muted-foreground">Status: {data.security.warning}</p>}
          {data && data.security.redisTls && <p className="text-muted-foreground">Status: this connection uses TLS. Durability still depends on your Redis plan, so keep backups on.</p>}
          <p>Backups are what protect you from data loss. <a className="underline" href="#backup">Check your backup setup</a>.</p>
        </div>
      </div>

      <div className="space-y-2" aria-busy={loading}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium"><Database className="size-4" /> Redis usage</h3>
          <Button type="button" variant="ghost" className="tap" onClick={() => void refresh()} disabled={loading} aria-label="Refresh storage status"><RefreshCw className={cn(loading && "animate-spin")} /></Button>
        </div>
        {error && !data ? (
          <p role="alert" className="text-sm text-destructive">Could not load storage status: {error.message}</p>
        ) : !data ? (
          <div aria-hidden className="h-10 animate-pulse rounded-lg bg-muted" />
        ) : !data.redis.ok ? (
          <p role="alert" className="text-sm text-destructive">The database is unreachable right now: {data.redis.error}</p>
        ) : used === null ? (
          <p className="text-sm text-muted-foreground">Redis did not report its memory use.</p>
        ) : (
          <>
            <div role="progressbar" aria-label="Redis memory used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={max ? `${mb(used)} of ${mb(max)}` : mb(used)} className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", data.storage.warn ? "bg-amber-500" : "bg-primary")} style={{ width: `${pct ?? 0}%` }} />
            </div>
            <p className="text-sm">{mb(used)}{max ? ` of ${mb(max)} (${pct}%)` : ""} <span className="text-muted-foreground">{max ? "" : "· the server did not report a limit"}</span></p>
            {data.storage.warn && <p className="text-sm text-amber-700 dark:text-amber-300">Storage is getting full. Archive or permanently delete codes you no longer need, or reset analytics.</p>}
            <p className="text-xs text-muted-foreground">The free tier is about 30 MB and the figure covers the whole Redis instance, including anything else stored there. Latency {data.redis.latencyMs} ms.</p>
          </>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">What is stored where</h3>
        <dl className="space-y-3 text-sm">
          {WHERE.map((w) => (
            <div key={w.title}>
              <dt className="font-medium">{w.title}</dt>
              <dd className="text-muted-foreground">{w.body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-sm text-muted-foreground">To export or import your library as JSON or CSV, go to the <Link className="underline" href="/library">Library page</Link>.</p>
    </Section>
  );
}
