"use client";
import {
    CloudOff,
    Download,
    FileDown,
    FileUp,
    Folder,
    FolderOpen,
    Loader2,
    MoreHorizontal,
    Plus,
    Printer,
    RefreshCw,
    Tags
} from "lucide-react";
import Link from "next/link";
import {useRouter, useSearchParams} from "next/navigation";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {toast} from "sonner";
import {PageHeader} from "@/components/page-header";
import {Button, buttonVariants} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {api, type BatchAction} from "@/lib/client/api";
import {formatDateTime, useOnline, usePending, useSettings} from "@/lib/client/hooks";
import {type CachedView, discardOp, flushQueue, type PendingOp, retryWithNewSlug} from "@/lib/client/offline";
import {cn} from "@/lib/utils";
import {ConfirmDialog, errMsg, ErrorNotice, InfoNotice, Skeleton, TAP, useDebounced} from "./common";
import {FolderDialog} from "./folder-dialog";
import {
    activeFilterCount,
    countTags,
    DEFAULT_FILTERS,
    filterItems,
    type Filters,
    parseTab,
    type Tab,
    tabCounts
} from "./filters";
import {ImportDialog} from "./import-dialog";
import {
    applyLocal,
    BATCH_VERB,
    type BatchResult,
    downloadItem,
    itemShortLink,
    printItems,
    runBatch
} from "./library-actions";
import {type FolderInfo, type ItemAction, LibraryItem, type PendingAction} from "./library-item";
import {LibraryToolbar} from "./library-toolbar";
import {SelectionBar} from "./selection-bar";
import {TagDialog} from "./tag-dialog";
import {useFolders, useLibrary} from "./use-library";

const VIEW_KEY = "qr.library.view";
const PAGE = 60;
const PRINT_MAX = 300;
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

const ITEM_BATCH: Partial<Record<ItemAction, BatchAction>> = {
    favorite: "favorite",
    unfavorite: "unfavorite",
    pin: "pin",
    unpin: "unpin",
    archive: "archive",
    restore: "restore",
    trash: "trash"
};

type Report = { title: string; failed: { name: string; error: string }[] };

function BatchReportDialog({report, onClose}: { report: Report | null; onClose: () => void }) {
    return (
        <Dialog open={report !== null} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{report?.title}</DialogTitle>
                    <DialogDescription>These codes were not changed:</DialogDescription>
                </DialogHeader>
                <ul className="grid gap-1.5 text-sm">
                    {report?.failed.map((f, i) => (
                        <li key={i} className="rounded-lg border px-2.5 py-1.5">
                            <span className="font-medium">{f.name}</span>
                            <span className="block text-xs text-destructive">{f.error}</span>
                        </li>
                    ))}
                </ul>
                <DialogFooter>
                    <Button className={TAP} onClick={onClose}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function LoadMore({shown, total, onMore}: { shown: number; total: number; onMore: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const latest = useRef(onMore);
    useEffect(() => {
        latest.current = onMore;
    });
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver((e) => e[0]?.isIntersecting && latest.current(), {rootMargin: "600px"});
        io.observe(el);
        return () => io.disconnect();
    }, [shown]);
    return (
        <div ref={ref} className="flex justify-center py-4">
            <Button variant="outline" className={TAP} onClick={onMore}>
                Show more ({shown.toLocaleString()} of {total.toLocaleString()})
            </Button>
        </div>
    );
}

function LoadingGrid() {
    return (
        <div aria-busy="true" aria-label="Loading library"
             className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({length: 10}, (_, i) => (
                <div key={i} className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
                    <Skeleton className="aspect-square w-full"/>
                    <Skeleton className="mt-3 h-4 w-3/4"/>
                    <Skeleton className="mt-2 h-3 w-1/2"/>
                </div>
            ))}
        </div>
    );
}

function EmptyState({icon: Icon, title, children}: {
    icon: typeof FolderOpen;
    title: string;
    children?: React.ReactNode
}) {
    return (
        <div className="grid place-items-center gap-2 border-y px-4 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><Icon
                className="size-6" aria-hidden/></span>
            <h2 className="text-base font-medium">{title}</h2>
            <div className="max-w-sm text-sm text-muted-foreground">{children}</div>
        </div>
    );
}

export function LibraryView() {
    const sp = useSearchParams();
    const router = useRouter();
    const online = useOnline();
    const {settings} = useSettings();
    const lib = useLibrary();
    const {items, mutate, refresh} = lib;
    const {folders, reload: reloadFolders} = useFolders();
    const {ops, syncing} = usePending();

    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const param = sp.get("status");
    const [tab, setTabState] = useState<Tab>(() => parseTab(param));
    const [seenParam, setSeenParam] = useState(param);
    if (param !== seenParam) {
        setSeenParam(param);
        setTabState(parseTab(param));
        setSelected(new Set());
    }
    const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
    const [layout, setLayoutState] = useState<"grid" | "list">(() => {
        try {
            return typeof localStorage !== "undefined" && localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
        } catch {
            return "list";
        }
    });
    const [selecting, setSelecting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [dialog, setDialog] = useState<"folders" | "tags" | "import" | null>(null);
    const [confirmPurge, setConfirmPurge] = useState<string[] | null>(null);
    const [report, setReport] = useState<Report | null>(null);

    const setLayout = (l: "grid" | "list") => {
        setLayoutState(l);
        try {
            localStorage.setItem(VIEW_KEY, l);
        } catch {
        }
    };
    const setTab = (t: Tab) => {
        setTabState(t);
        setSelected(new Set());
    };

    const q = useDebounced(filters.q, 200);
    const filtered = useMemo(() => filterItems(items, tab, filters, q), [items, tab, filters, q]);
    const counts = useMemo(() => tabCounts(items), [items]);
    const tags = useMemo(() => countTags(items), [items]);
    const folderMap = useMemo(() => new Map<string, FolderInfo>(folders.map((f) => [f.id, {
        name: f.name,
        color: f.color
    }])), [folders]);
    const opByCode = useMemo(() => {
        const m = new Map<string, PendingOp>();
        for (const op of ops) {
            const id = op.kind === "create" ? op.input.id : op.id;
            if (!m.has(id) || op.status === "failed") m.set(id, op);
        }
        return m;
    }, [ops]);

    const resetKey = `${tab}|${q}|${filters.type}|${filters.mode}|${filters.folder}|${filters.tag}|${filters.favorite}|${filters.state}|${filters.sort}|${filters.dir}`;
    const [lim, setLim] = useState({key: resetKey, n: PAGE});
    const limit = lim.key === resetKey ? lim.n : PAGE;
    const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

    const selIds = useMemo(() => filtered.filter((i) => selected.has(i.id)).map((i) => i.id), [filtered, selected]);
    const selItems = useMemo(() => filtered.filter((i) => selected.has(i.id)), [filtered, selected]);
    const selTags = useMemo(() => [...new Set(selItems.flatMap((i) => i.tags))].sort(), [selItems]);

    const toggle = useCallback((id: string) => setSelected((s) => {
        const n = new Set(s);
        if (!n.delete(id)) n.add(id);
        return n;
    }), []);

    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    const perform = useCallback(
        async (ids: string[], action: BatchAction, value?: string | null) => {
            if (!ids.length) return;
            setBusy(true);
            try {
                const results: BatchResult[] = await runBatch(ids, action, value);
                const ok = new Set(results.filter((r) => r.ok).map((r) => r.id));
                mutate((all) => (action === "purge" ? all.filter((i) => !ok.has(i.id)) : all.map((i) => (ok.has(i.id) ? applyLocal(i, action, value) : i))));
                if (action === "purge" || action === "archive" || action === "restore" || action === "trash") setSelected((s) => new Set([...s].filter((id) => !ok.has(id))));
                const failed = results.filter((r) => !r.ok);
                if (!failed.length) toast.success(`${BATCH_VERB[action]} ${plural(ids.length, "code")}`);
                else {
                    const name = (id: string) => itemsRef.current.find((i) => i.id === id)?.name ?? id;
                    if (ids.length === 1) toast.error(failed[0]?.error ?? "Could not complete that action");
                    else {
                        toast.warning(`${BATCH_VERB[action]} ${ok.size} of ${ids.length}; ${failed.length} failed`);
                        setReport({
                            title: `${failed.length} of ${ids.length} could not be updated`,
                            failed: failed.map((f) => ({name: name(f.id), error: f.error ?? "Failed"}))
                        });
                    }
                }
                void refresh();
            } finally {
                setBusy(false);
            }
        },
        [mutate, refresh],
    );

    const requestRun = (action: BatchAction, value?: string | null) => {
        if (!online) return toast.error("You're offline. Changes to codes need a connection.");
        if (action === "purge") setConfirmPurge(selIds);
        else void perform(selIds, action, value);
    };

    const onAction = useCallback(
        async (a: ItemAction, item: CachedView) => {
            const batch = ITEM_BATCH[a];
            if (batch) return void perform([item.id], batch);
            try {
                if (a === "purge") setConfirmPurge([item.id]);
                else if (a === "duplicate") {
                    const copy = await api.codes.duplicate(item.id);
                    mutate((all) => [copy, ...all]);
                    toast.success(`Duplicated as “${copy.name}”`, {
                        action: {
                            label: "Open",
                            onClick: () => router.push(`/library/${copy.id}`)
                        }
                    });
                } else if (a === "png" || a === "svg") {
                    await downloadItem(item, a, settings.filenameTemplate);
                } else if (a === "copy-link") {
                    const link = itemShortLink(item);
                    if (!link) return;
                    await navigator.clipboard.writeText(link);
                    toast.success("Short link copied", {description: link});
                }
            } catch (e) {
                toast.error(errMsg(e, "That did not work"));
            }
        },
        [perform, mutate, router, settings.filenameTemplate],
    );

    const onPending = useCallback(
        async (a: PendingAction, op: PendingOp) => {
            try {
                if (a === "retry-slug" && op.kind === "create") {
                    await retryWithNewSlug(op);
                    toast.message("Retrying with a new short link…");
                } else {
                    await discardOp(op);
                    if (op.kind === "update") mutate((all) => all.map((i) => (i.id === op.id ? {...op.base} : i)));
                    else if (op.kind === "trash") mutate((all) => all.map((i) => (i.id === op.id ? {
                        ...i,
                        status: "active",
                        _pending: undefined,
                        _error: undefined
                    } : i)));
                    toast.success("Discarded");
                }
            } catch (e) {
                toast.error(errMsg(e));
            }
        },
        [mutate],
    );

    const syncNow = async () => {
        const r = await flushQueue();
        if (r.stopped) toast.error("Still can't reach the server. Your changes are kept and will retry.");
        else toast[r.failed ? "warning" : "success"](`Synced ${r.synced}${r.failed ? `, ${r.failed} need attention` : ""}${r.conflicts.length ? `, ${r.conflicts.length} saved as offline-edit copies` : ""}`);
        void refresh();
    };

    const print = async (list: CachedView[]) => {
        if (!list.length) return toast.error("Nothing to print");
        const take = list.slice(0, PRINT_MAX);
        const id = toast.loading(`Preparing ${plural(take.length, "code")} to print…`);
        try {
            await printItems(take, (d, t) => toast.loading(`Preparing codes to print… ${d}/${t}`, {id}));
            toast.success(list.length > take.length ? `Printing the first ${PRINT_MAX} of ${list.length}` : "Print dialog opened", {id});
        } catch (e) {
            toast.error(errMsg(e, "Could not prepare the print layout"), {id});
        }
    };

    const showCached = lib.ready && (lib.source === "cache" || !online);
    const hasAny = items.length > 0;
    const filtering = Boolean(filters.q.trim() || activeFilterCount(filters));

    return (
        <div>
            <PageHeader
                title="Library"
                actions={
                    <>
                        <Link href="/" className={cn(buttonVariants(), TAP)}><Plus/> New code</Link>
                        <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="outline" className={TAP}/>}>
                                <MoreHorizontal/> Manage
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-56">
                                <DropdownMenuGroup>
                                    <DropdownMenuItem className="min-h-10 md:min-h-8"
                                                      onClick={() => setDialog("folders")}><Folder/> Folders…</DropdownMenuItem>
                                    <DropdownMenuItem className="min-h-10 md:min-h-8" onClick={() => setDialog("tags")}><Tags/> Tags…</DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator/>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem className="min-h-10 md:min-h-8"
                                                      onClick={() => void print(selecting && selIds.length ? selItems : filtered)}><Printer/> Print {selecting && selIds.length ? "selected" : "filtered"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="min-h-10 md:min-h-8"
                                                      render={<a href={api.library.exportUrl("json")}
                                                                 download/>}><FileDown/> Export JSON
                                        (backup)</DropdownMenuItem>
                                    <DropdownMenuItem className="min-h-10 md:min-h-8"
                                                      render={<a href={api.library.exportUrl("csv")}
                                                                 download/>}><Download/> Export CSV</DropdownMenuItem>
                                    <DropdownMenuItem className="min-h-10 md:min-h-8"
                                                      onClick={() => setDialog("import")}><FileUp/> Import…</DropdownMenuItem>
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </>
                }
            />

            {showCached ? (
                <InfoNotice tone="warn" className="mb-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <CloudOff className="size-4 shrink-0" aria-hidden/>
                        <span className="min-w-0 flex-1">
              {lib.cachedAt ? <>Showing a cached copy
                  from {formatDateTime(lib.cachedAt, settings.timezone)}.</> : <>Showing the copy stored on this
                  device.</>}{" "}
                            {online && lib.error ? <span
                                className="opacity-80">The server did not answer: {lib.error}</span> : "Search, filters and downloads still work; edits need a connection."}
            </span>
                        <Button variant="outline" size="sm" className={cn(TAP, "md:min-h-7")}
                                disabled={lib.refreshing || !online} onClick={() => void refresh()}>
                            {lib.refreshing ? <Loader2 className="animate-spin"/> : <RefreshCw/>} Retry
                        </Button>
                    </div>
                </InfoNotice>
            ) : null}
            {lib.total > items.length && lib.source === "live" ?
                <InfoNotice className="mb-4">Showing the {items.length.toLocaleString()} most recent
                    of {lib.total.toLocaleString()} codes. Use search and filters to find older
                    ones.</InfoNotice> : null}
            {lib.unreadable > 0 ?
                <InfoNotice tone="warn" className="mb-4">{plural(lib.unreadable, "record")} could not be read
                    and {lib.unreadable === 1 ? "is" : "are"} hidden. Run a repair in Settings.</InfoNotice> : null}

            {!lib.ready ? (
                <LoadingGrid/>
            ) : !hasAny && lib.error ? (
                <ErrorNotice title="Could not load your library" message={lib.error} onRetry={() => void refresh()}/>
            ) : !hasAny && lib.refreshing ? (
                <LoadingGrid/>
            ) : !hasAny && folders.length === 0 ? (
                <EmptyState icon={FolderOpen} title="No codes yet">
                    <p>Create your first QR code and it will show up here, ready to search, organise and download.</p>
                    <Link href="/" className={cn(buttonVariants(), TAP, "mt-4")}><Plus/> Create a QR code</Link>
                </EmptyState>
            ) : (
                <>
                    <LibraryToolbar
                        tab={tab}
                        onTab={setTab}
                        counts={counts}
                        filters={filters}
                        onFilters={setFilters}
                        folders={folders}
                        tags={tags}
                        layout={layout}
                        onLayout={setLayout}
                        selecting={selecting}
                        onSelecting={(v) => {
                            setSelecting(v);
                            if (!v) setSelected(new Set());
                        }}
                        shown={filtered.length}
                    />

                    {tab === "active" && folders.length > 0 ? (
                        <section aria-labelledby="library-folders" className="mb-4 grid gap-2">
                            <h2 id="library-folders" className="text-sm font-medium">Folders</h2>
                            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                {folders.map((folder) => (
                                    <li key={folder.id} className="min-w-0">
                                        <Button variant={filters.folder === folder.id ? "secondary" : "outline"}
                                                className={cn(TAP, "w-full justify-start")}
                                                aria-pressed={filters.folder === folder.id}
                                                title={folder.name}
                                                onClick={() => setFilters({
                                                    ...filters,
                                                    folder: filters.folder === folder.id ? "" : folder.id
                                                })}>
                                            <Folder aria-hidden style={{color: folder.color ?? undefined}}/>
                                            <span className="truncate">{folder.name}</span>
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    {tab === "pending" && counts.pending > 0 ? (
                        <InfoNotice className="mb-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="min-w-0 flex-1">
                                    {online ? "These changes were made offline and haven't reached the server yet. Failed ones need a decision." : "You're offline. These changes will sync automatically when you reconnect."}
                                </p>
                                <Button variant="outline" className={TAP} disabled={!online || syncing}
                                        onClick={() => void syncNow()}>
                                    {syncing ? <Loader2 className="animate-spin"/> : <RefreshCw/>} Sync now
                                </Button>
                            </div>
                        </InfoNotice>
                    ) : null}

                    {filtered.length === 0 ? (
                        <EmptyState icon={FolderOpen}
                                    title={tab === "pending" ? "Everything is synced" : tab === "trashed" ? "Trash is empty" : tab === "archived" ? "Nothing archived" : filtering ? "No codes match" : "No active codes"}>
                            {tab === "pending" ? <p>No changes are waiting to sync.</p> : tab === "trashed" ?
                                <p>Codes you move to the trash wait here until you restore or delete
                                    them.</p> : filtering ? (
                                    <>
                                        <p>Nothing matches your search and filters in this section.</p>
                                        <Button variant="outline" className={cn(TAP, "mt-3")}
                                                onClick={() => setFilters({
                                                    ...DEFAULT_FILTERS,
                                                    sort: filters.sort,
                                                    dir: filters.dir
                                                })}>Clear filters</Button>
                                    </>
                                ) : (
                                    <p>{tab === "archived" ? "Archive codes you no longer use; their links keep working until you pause them." : "Restore codes from the archive or trash, or create a new one."}</p>
                                )}
                        </EmptyState>
                    ) : (
                        <div
                            className={layout === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "grid"}
                            aria-busy={lib.refreshing}>
                            {visible.map((item) => (
                                <LibraryItem
                                    key={item.id}
                                    item={item}
                                    layout={layout}
                                    selecting={selecting}
                                    selected={selected.has(item.id)}
                                    offline={!online}
                                    folder={item.folder ? folderMap.get(item.folder) : undefined}
                                    op={tab === "pending" ? opByCode.get(item.id) : undefined}
                                    syncing={syncing}
                                    onToggle={toggle}
                                    onAction={onAction}
                                    onPending={onPending}
                                />
                            ))}
                        </div>
                    )}
                    {filtered.length > visible.length ? <LoadMore shown={visible.length} total={filtered.length}
                                                                  onMore={() => setLim({
                                                                      key: resetKey,
                                                                      n: limit + PAGE
                                                                  })}/> : null}

                    {selecting ? (
                        <SelectionBar
                            tab={tab}
                            count={selIds.length}
                            total={filtered.length}
                            offline={!online}
                            busy={busy}
                            folders={folders}
                            allTags={tags.map((t) => t.tag)}
                            selectedTags={selTags}
                            onSelectAll={() => setSelected(new Set(filtered.map((i) => i.id)))}
                            onClear={() => setSelected(new Set())}
                            onRun={requestRun}
                            onPrint={() => void print(selItems)}
                        />
                    ) : null}
                </>
            )}

            <FolderDialog open={dialog === "folders"} onOpenChange={(o) => setDialog(o ? "folders" : null)}
                          offline={!online} onChanged={() => {
                reloadFolders();
                void refresh();
            }}/>
            <TagDialog open={dialog === "tags"} onOpenChange={(o) => setDialog(o ? "tags" : null)} offline={!online}
                       onChanged={() => void refresh()}/>
            <ImportDialog open={dialog === "import"} onOpenChange={(o) => setDialog(o ? "import" : null)}
                          offline={!online} onImported={() => {
                reloadFolders();
                void refresh();
            }}/>
            <ConfirmDialog
                open={confirmPurge !== null}
                onOpenChange={(o) => !o && setConfirmPurge(null)}
                title={`Delete ${confirmPurge && confirmPurge.length > 1 ? `${confirmPurge.length} codes` : "this code"} forever?`}
                description="This cannot be undone. The codes, their dynamic links and their scan counts are removed permanently. Printed copies of dynamic codes will stop working."
                confirmLabel="Delete forever"
                onConfirm={async () => {
                    const ids = confirmPurge ?? [];
                    setConfirmPurge(null);
                    await perform(ids, "purge");
                }}
            />
            <BatchReportDialog report={report} onClose={() => setReport(null)}/>
        </div>
    );
}
