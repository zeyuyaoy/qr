"use client";
import { ArrowLeft, Clipboard, CloudOff, ExternalLink, FileQuestion, Loader2, Pin, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeAnalytics } from "@/components/analytics/code-analytics";
import { QrEditor } from "@/components/qr/qr-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiClientError, api } from "@/lib/client/api";
import { formatDateTime, useOnline, useSettings } from "@/lib/client/hooks";
import { library, type CachedView } from "@/lib/client/offline";
import { TYPES } from "@/lib/qr/payload";
import type { QrView } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { ItemBadges } from "./badges";
import { ErrorNotice, errMsg, InfoNotice, Skeleton, TAP } from "./common";
import { ApplyTemplate, DangerZone } from "./detail-actions";
import { LazyQr } from "./lazy-qr";
import { itemData, itemShortLink } from "./library-actions";

type State =
  | { kind: "loading" }
  | { kind: "ready"; view: CachedView; source: "live" | "cache"; reason?: string }
  | { kind: "notfound" }
  | { kind: "error"; message: string };

/** Live copy first; the cached copy when offline or the server errors. Never throws. */
async function fetchCode(id: string): Promise<State> {
  const cached = async () => (await library.read()).items.find((i) => i.id === id);
  try {
    const v = await api.codes.get(id);
    void library.upsert(v);
    return { kind: "ready", view: v, source: "live" };
  } catch (e) {
    const local = await cached();
    if (e instanceof ApiClientError && e.code === "NOT_FOUND") {
      // A code created offline exists only on this device until it syncs.
      return local && local._pending === "create" ? { kind: "ready", view: local, source: "cache" } : { kind: "notfound" };
    }
    if (local) return { kind: "ready", view: local, source: "cache", reason: e instanceof Error ? e.message : undefined };
    return { kind: "error", message: errMsg(e, "Could not load this code") };
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export function DetailView({ id }: { id: string }) {
  const online = useOnline();
  const { settings } = useSettings();
  const [state, setState] = useState<State>({ kind: "loading" });
  /** Bumped when something outside the editor changes the code (template applied), so the editor reloads it. */
  const [epoch, setEpoch] = useState(0);

  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => fetchCode(id).then(setState), [id]);

  useEffect(() => {
    let alive = true;
    void fetchCode(id).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const onSaved = useCallback((v: QrView) => setState((s) => (s.kind === "ready" ? { ...s, view: v, source: "live", reason: undefined } : s)), []);

  if (state.kind === "loading")
    return (
      <div aria-busy="true" aria-label="Loading code" className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );

  if (state.kind === "notfound")
    return (
      <div className="grid place-items-center gap-3 rounded-2xl border border-dashed px-4 py-16 text-center">
        <FileQuestion className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Code not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">It may have been deleted, or the link is wrong.</p>
        <Link href="/library" className={cn(buttonVariants(), TAP)}><ArrowLeft /> Back to library</Link>
      </div>
    );

  if (state.kind === "error")
    return (
      <div className="grid gap-4">
        <Link href="/library" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Library</Link>
        <ErrorNotice title="Could not load this code" message={state.message} onRetry={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }} />
      </div>
    );

  const { view, source } = state;
  const pendingCreate = view._pending === "create" || view.rev === 0;
  const link = itemShortLink(view);

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/library" className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:min-h-8">
          <ArrowLeft className="size-4" aria-hidden /> Library
        </Link>
        <header className="mt-2 grid gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight sm:text-2xl">{view.name}</h1>
            {view.favorite ? <Star role="img" aria-label="Favorite" className="size-4 fill-amber-400 text-amber-500" /> : null}
            {view.pinned ? <Pin role="img" aria-label="Pinned" className="size-4 text-muted-foreground" /> : null}
          </div>
          <ItemBadges item={view} showStatus />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Fact label="Type">{TYPES[view.type].label}</Fact>
            <Fact label="Created">{formatDateTime(view.createdAt, settings.timezone)}</Fact>
            <Fact label="Last updated">{formatDateTime(view.updatedAt, settings.timezone)}</Fact>
            {view.mode === "dynamic" ? <Fact label="Scans">{view.scans.toLocaleString()}</Fact> : <Fact label="Mode">Static (no tracking)</Fact>}
          </dl>
          {view.mode === "dynamic" && link && !pendingCreate ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 p-2 text-sm">
              <code className="min-w-0 flex-1 break-all px-1 text-xs">{link}</code>
              <Button
                variant="outline"
                size="sm"
                className={cn(TAP, "md:min-h-7")}
                onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("Short link copied"), () => toast.error("Could not copy"))}
              >
                <Clipboard /> Copy
              </Button>
              <a href={link} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), TAP, "md:min-h-7")}>
                <ExternalLink /> Open
              </a>
            </div>
          ) : null}
        </header>
      </div>

      {source === "cache" && !pendingCreate ? (
        <InfoNotice tone="warn">
          <span className="flex items-start gap-2">
            <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Showing the copy saved on this device{state.reason ? ` (${state.reason})` : ""}. Edits are queued and sync when you&apos;re back online; scan counts may be out of date.{" "}
              {online ? <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button> : null}
            </span>
          </span>
        </InfoNotice>
      ) : null}

      {view.status !== "active" ? (
        <InfoNotice tone="warn">{view.status === "trashed" ? "This code is in the trash. Its link does not redirect." : "This code is archived."}</InfoNotice>
      ) : null}

      {pendingCreate ? (
        <section className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-[200px_1fr]">
          <LazyQr data={itemData(view)} style={view.style} size={400} label={`QR code for ${view.name}`} />
          <div className="grid content-start gap-2 text-sm">
            <h2 className="flex items-center gap-2 text-base font-medium">
              {view._error ? null : <Loader2 className="size-4 animate-spin" aria-hidden />} {view._error ? "This code could not be synced" : "Waiting to sync"}
            </h2>
            <p className="text-muted-foreground">
              {view._error ?? "This code was created offline. It becomes editable once it has been saved to the server."}
              {view.mode === "dynamic" ? " Its short link is not live yet." : ""}
            </p>
            <Link href="/library?status=pending" className={cn(buttonVariants({ variant: "outline" }), TAP, "justify-self-start")}>Review pending changes</Link>
          </div>
        </section>
      ) : (
        <>
          <QrEditor key={`${view.id}:${epoch}`} mode="edit" initial={view} onSaved={onSaved} />

          {view.mode === "dynamic" ? (
            <section aria-labelledby="analytics-h" className="rounded-2xl border bg-card p-4">
              <h2 id="analytics-h" className="mb-3 text-base font-medium">Scan analytics</h2>
              {online ? <CodeAnalytics id={view.id} /> : <p className="text-sm text-muted-foreground">Analytics need a connection.</p>}
            </section>
          ) : null}

          <ApplyTemplate
            id={view.id}
            offline={!online}
            onApplied={() => void load().then(() => setEpoch((n) => n + 1))}
          />
          <DangerZone view={view} offline={!online} onChanged={() => void load()} />
        </>
      )}
    </div>
  );
}
