"use client";
import {zipSync} from "fflate";
import {Archive, CloudOff, Loader2, RefreshCw, Save, X} from "lucide-react";
import Link from "next/link";
import {useMemo, useState} from "react";
import {toast} from "sonner";
import {errMsg, InfoNotice, TAP, useDebounced} from "@/components/library/common";
import {useFolders} from "@/components/library/use-library";
import {PageHeader} from "@/components/page-header";
import {Button, buttonVariants} from "@/components/ui/button";
import {Progress, ProgressLabel, ProgressValue} from "@/components/ui/progress";
import {useOnline, useSettings} from "@/lib/client/hooks";
import {resolveLogoUrl} from "@/lib/client/logo";
import {newId, newOpId, newSlug} from "@/lib/ids";
import {downloadBlob, makeFilename} from "@/lib/qr/export";
import {clientAppUrl, qrData} from "@/lib/qr/payload";
import {renderBlob} from "@/lib/qr/render";
import {type CreateInput, defaultStyle} from "@/lib/schema";
import {cn} from "@/lib/utils";
import {BulkInput, BulkMapping, type Source} from "./bulk-input";
import {BulkRows, type RowView} from "./bulk-rows";
import {type BulkCfg, BulkSettings} from "./bulk-settings";
import {detectHeader, parseCsv, parseLines} from "./csv";
import {buildRows, guessMapping, isIncluded, type Mapping, MAX_ROWS, NO_MAPPING, uniqueNames} from "./rows";
import {useBulkRun} from "./use-bulk-run";

const SAMPLE = "https://example.com/qr-studio";

function newPool() {
    const slugs = new Set<string>();
    while (slugs.size < MAX_ROWS) slugs.add(newSlug());
    return {
        ids: Array.from({length: MAX_ROWS}, newId),
        ops: Array.from({length: MAX_ROWS}, newOpId),
        slugs: [...slugs]
    };
}

function Step({n, title, children, id}: { n: number; title: string; children: React.ReactNode; id?: string }) {
    return (
        <section id={id} aria-labelledby={`${id ?? `step${n}`}-h`} className="min-w-0 border-t pt-3">
            <h2 id={`${id ?? `step${n}`}-h`} className="mb-3 flex items-center gap-2 text-base font-medium">
                <span aria-hidden
                      className="grid size-6 place-items-center rounded-full bg-muted text-xs text-foreground">{n}</span>
                {title}
            </h2>
            {children}
        </section>
    );
}

async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
    const used = new Set<string>();
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) {
        let name = f.name;
        for (let i = 2; used.has(name.toLowerCase()); i++) name = f.name.replace(/(\.[^.]+)?$/, `-${i}$1`);
        used.add(name.toLowerCase());
        entries[name] = new Uint8Array(await f.blob.arrayBuffer());
    }
    const zipped = zipSync(entries, {level: 0});
    return new Blob([zipped.buffer as ArrayBuffer], {type: "application/zip"});
}

export function BulkView() {
    const online = useOnline();
    const {settings, loaded} = useSettings();
    const {folders, loaded: foldersLoaded} = useFolders();
    const run = useBulkRun();

    const [source, setSource] = useState<Source>("urls");
    const [text, setText] = useState("");
    const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
    const [mapOverride, setMapOverride] = useState<Mapping | null>(null);
    const [allowDup, setAllowDup] = useState(false);

    const [cfg, setCfg] = useState<BulkCfg>(() => ({
        mode: "static",
        style: defaultStyle(),
        format: "png",
        filename: "{name}",
        templateKey: ""
    }));
    const [seeded, setSeeded] = useState(false);
    if (loaded && !seeded) {
        setSeeded(true);
        setCfg({
            mode: settings.mode,
            style: settings.defaultStyle,
            format: settings.format,
            filename: settings.filenameTemplate,
            templateKey: ""
        });
    }
    const patchCfg = (p: Partial<BulkCfg>) => {
        setSeeded(true);
        setCfg((c) => ({...c, ...p}));
    };

    const dtext = useDebounced(text, 250);
    const table = useMemo(() => (source === "urls" ? parseLines(dtext) : parseCsv(dtext)), [source, dtext]);
    const cols = useMemo(() => Math.max(0, ...table.rows.slice(0, 100).map((r) => r.length)), [table]);
    const header = source === "csv" && (headerOverride ?? detectHeader(table.rows[0]));
    const guess = useMemo(() => guessMapping(table, header), [table, header]);
    const mapping = useMemo<Mapping>(() => {
        if (source === "urls") return NO_MAPPING;
        const m = mapOverride ?? guess;
        const fit = (i: number) => (i < cols ? i : -1);
        return {
            url: Math.max(0, fit(m.url)),
            name: fit(m.name),
            tags: fit(m.tags),
            slug: fit(m.slug),
            folder: fit(m.folder)
        };
    }, [source, mapOverride, guess, cols]);
    const folderList = foldersLoaded && (online || folders.length > 0) ? folders : null;
    const built = useMemo(() => buildRows(table, {
        mode: cfg.mode,
        header,
        mapping,
        folders: folderList
    }), [table, cfg.mode, header, mapping, folderList]);

    const [pool, setPool] = useState(newPool);
    const [slugFix, setSlugFix] = useState<Record<string, string>>({});
    const appUrl = useMemo(() => clientAppUrl(), []);
    const base = useMemo<RowView[]>(() => {
        const flags = built.rows.map((r) => isIncluded(r, allowDup));
        const slugOf = (r: (typeof built.rows)[number]) => (cfg.mode === "dynamic" ? (slugFix[r.key] ?? r.slug ?? pool.slugs[r.index] ?? null) : null);
        const names = uniqueNames(
            built.rows.flatMap((r, i) => (flags[i] ? [{
                key: r.key,
                name: makeFilename(cfg.filename, {name: r.name, type: "url", slug: slugOf(r)}, cfg.format)
            }] : [])),
        );
        return built.rows.map((r, i) => {
            const slug = slugOf(r);
            return {
                row: r,
                included: flags[i] ?? false,
                slug,
                data: r.payload ? qrData({mode: cfg.mode, payload: r.payload, slug}, appUrl) : null,
                filename: names.get(r.key) ?? null
            };
        });
    }, [built, allowDup, cfg.mode, cfg.filename, cfg.format, pool, slugFix, appUrl]);
    const incl = useMemo(() => base.filter((v) => v.included), [base]);

    const rowsSig = useMemo(() => JSON.stringify([cfg.mode, incl.map((v) => [v.row.key, v.row.payload, v.row.name, v.row.tags, v.row.slug, v.row.folder])]), [cfg.mode, incl]);
    const [savedSig, setSavedSig] = useState<string | null>(null);
    const [editedAfterSave, setEditedAfterSave] = useState(false);
    if (savedSig !== null && savedSig !== rowsSig) {
        setSavedSig(null);
        setEditedAfterSave(Object.values(run.saves).some((s) => s.state === "saved"));
        setPool(newPool());
        setSlugFix({});
        run.resetSaves();
    }
    const views = useMemo(() => (Object.keys(run.saves).length ? base.map((v) => (run.saves[v.row.key] ? {
        ...v,
        save: run.saves[v.row.key]
    } : v)) : base), [base, run.saves]);

    const invalid = built.rows.filter((r) => r.error).length;
    const dups = built.rows.filter((r) => !r.error && r.duplicateOf !== null).length;
    const savedN = incl.filter((v) => run.saves[v.row.key]?.state === "saved").length;
    const failedKeys = incl.filter((v) => run.saves[v.row.key]?.state === "failed");
    const toSave = incl.length - savedN;

    const sig = useMemo(() => JSON.stringify([cfg.format, cfg.style, incl.map((v) => [v.row.key, v.data])]), [cfg.format, cfg.style, incl]);
    const current = run.blobs && run.blobs.sig === sig ? run.blobs.map : null;
    const rendered = current ? incl.filter((v) => current.has(v.row.key)).length : 0;
    const [zipping, setZipping] = useState(false);
    const [downloading, setDownloading] = useState<string | null>(null);
    const genBusy = run.gen.phase === "running" || zipping;

    const jobs = () => incl.flatMap((v) => (v.data ? [{key: v.row.key, data: v.data}] : []));

    const downloadZip = async () => {
        setZipping(true);
        try {
            let map = current;
            if (!map || rendered < incl.length) {
                const r = await run.generate(jobs(), cfg.style, cfg.format, sig);
                if (r.cancelled) return void toast.message(`Cancelled. ${r.map.size} of ${incl.length} were rendered.`);
                if (r.failed) toast.warning(`${r.failed} could not be rendered and are left out of the ZIP`);
                map = r.map;
            }
            const files = incl.flatMap((v) => {
                const blob = map?.get(v.row.key);
                return blob && v.filename ? [{name: v.filename, blob}] : [];
            });
            if (!files.length) return void toast.error("Nothing could be rendered");
            downloadBlob(await zipFiles(files), `qr-codes-${new Date().toISOString().slice(0, 10)}.zip`);
            toast.success(`Downloaded ${files.length} ${files.length === 1 ? "code" : "codes"} as a ZIP`);
        } catch (e) {
            toast.error(errMsg(e, "Could not build the ZIP"));
        } finally {
            setZipping(false);
        }
    };

    const downloadOne = async (key: string) => {
        const v = incl.find((x) => x.row.key === key);
        if (!v?.data || !v.filename) return;
        setDownloading(key);
        try {
            const blob = current?.get(key) ?? (await renderBlob({
                data: v.data,
                style: cfg.style,
                logoUrl: await resolveLogoUrl(cfg.style.logo.assetId),
                format: cfg.format
            }));
            downloadBlob(blob, v.filename);
        } catch (e) {
            toast.error(errMsg(e, "Could not render this code"));
        } finally {
            setDownloading(null);
        }
    };

    const startSave = async (only: "pending" | "failed") => {
        const targets = only === "failed" ? failedKeys : incl.filter((v) => run.saves[v.row.key]?.state !== "saved");
        if (!targets.length) return;
        const fix: Record<string, string> = {};
        for (const v of targets) {
            const s = run.saves[v.row.key];
            if (s?.state === "failed" && s.code === "SLUG_TAKEN" && v.row.slug === null) fix[v.row.key] = newSlug();
        }
        if (Object.keys(fix).length) setSlugFix((f) => ({...f, ...fix}));
        setEditedAfterSave(false);
        setSavedSig(rowsSig);
        const items = targets.flatMap((v) => {
            const id = pool.ids[v.row.index];
            const opId = pool.ops[v.row.index];
            if (!id || !opId || !v.row.payload) return [];
            const slug = fix[v.row.key] ?? v.slug;
            const input: CreateInput = {
                id,
                opId,
                name: v.row.name,
                type: "url",
                mode: cfg.mode,
                fields: {url: v.row.payload},
                payload: v.row.payload,
                style: cfg.style,
                tags: v.row.tags,
                folder: v.row.folder, ...(cfg.mode === "dynamic" && slug ? {slug} : {})
            };
            return [{key: v.row.key, input}];
        });
        await run.save(items);
    };

    const startOver = () => {
        setText("");
        setHeaderOverride(null);
        setMapOverride(null);
        setAllowDup(false);
        setSavedSig(null);
        setEditedAfterSave(false);
        setPool(newPool());
        setSlugFix({});
        run.resetSaves();
        run.resetOutputs();
    };

    const first = incl[0] ?? base.find((v) => v.data);
    const pct = run.gen.total ? Math.round((run.gen.done / run.gen.total) * 100) : 0;
    const savePct = run.saving.total ? Math.round((run.saving.done / run.saving.total) * 100) : 0;
    const hasInput = table.rows.length > 0;

    return (
        <div>
            <PageHeader
                title="Bulk generator"
                description={`Create up to ${MAX_ROWS} codes from a list or CSV.`}
                actions={
                    hasInput || run.blobs ? (
                        <Button variant="outline" className={TAP} disabled={genBusy || run.saving.running}
                                onClick={startOver}>
                            <X/> Start over
                        </Button>
                    ) : null
                }
            />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start lg:gap-x-8">
                <div className="grid min-w-0 gap-4">
                    <Step n={1} title="Add your links">
                        <BulkInput
                            source={source}
                            onSource={(s) => {
                                setSource(s);
                                setHeaderOverride(null);
                                setMapOverride(null);
                            }}
                            text={text}
                            onText={setText}
                            header={header}
                            onHeader={setHeaderOverride}
                            table={table}
                        />
                        {hasInput ? (
                            <p className="mt-3 text-sm" aria-live="polite">
                                <strong
                                    className="text-emerald-700 dark:text-emerald-400">{built.rows.length - invalid - dups} valid</strong>
                                {dups ? <>, <strong
                                    className="text-amber-700 dark:text-amber-300">{dups} {dups === 1 ? "duplicate" : "duplicates"}</strong></> : null}
                                {invalid ? <>, <strong
                                    className="text-destructive">{invalid} invalid</strong> (excluded)</> : null}
                                {invalid || dups ? <>. <a href="#bulk-rows" className="underline">Review
                                    rows</a></> : null}
                            </p>
                        ) : null}
                        {built.truncated > 0 ?
                            <InfoNotice tone="warn" className="mt-3">Only the first {MAX_ROWS} rows are
                                used; {built.truncated} more {built.truncated === 1 ? "was" : "were"} ignored. Run the
                                rest as a second batch.</InfoNotice> : null}
                    </Step>

                    {source === "csv" && hasInput ? (
                        <details className="border-t">
                            <summary
                                className="tap cursor-pointer py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">CSV
                                columns
                            </summary>
                            <BulkMapping table={table} header={header} mapping={mapping} onMapping={setMapOverride}
                                         mode={cfg.mode}/>
                        </details>
                    ) : null}
                    <details className="border-t">
                        <summary
                            className="tap cursor-pointer py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Style
                            and export settings
                        </summary>
                        <BulkSettings cfg={cfg} onChange={patchCfg} defaultStyle={settings.defaultStyle}
                                      sampleData={first?.data ?? SAMPLE} sampleName={first?.row.name ?? "Example"}
                                      sampleSlug={first?.slug ?? null}/>
                    </details>
                </div>

                <Step n={2} title="Download or save">
                    <div className="grid gap-3">
                        <p className="text-sm" aria-live="polite">
                            <strong>{incl.length}</strong> {incl.length === 1 ? "code is" : "codes are"} ready
                            {invalid ? <>, {invalid} excluded because of errors</> : null}
                            {dups ? <>, {dups} {dups === 1 ? "duplicate" : "duplicates"} {allowDup ? "included" : "excluded"}</> : null}.
                        </p>
                        {dups ? (
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-8">
                                <input type="checkbox" className="size-5 accent-primary md:size-4" checked={allowDup}
                                       onChange={(e) => setAllowDup(e.target.checked)}/>
                                Include duplicate URLs anyway
                            </label>
                        ) : null}
                        {cfg.mode === "dynamic" ? (
                            <InfoNotice tone="warn">
                                Dynamic codes encode a short link that only works once the code is saved to your
                                library. Save them before you print or share the images.
                            </InfoNotice>
                        ) : null}
                        {!folderList && mapping.folder >= 0 ?
                            <InfoNotice>Folders are unavailable, so the folder column is ignored.</InfoNotice> : null}
                        {source === "csv" && cfg.mode === "static" && mapping.slug >= 0 ?
                            <InfoNotice>The slug column is ignored for static codes.</InfoNotice> : null}

                        <div className="flex flex-wrap gap-2">
                            <Button className={TAP} disabled={incl.length === 0 || genBusy || run.saving.running}
                                    onClick={() => void downloadZip()}>
                                {genBusy ? <Loader2 className="animate-spin"/> : <Archive/>} Download all as ZIP
                                ({incl.length})
                            </Button>
                            <Button variant="secondary" className={TAP}
                                    disabled={!online || toSave === 0 || genBusy || run.saving.running}
                                    onClick={() => void startSave("pending")}>
                                {run.saving.running ? <Loader2 className="animate-spin"/> :
                                    <Save/>} Save {toSave === incl.length ? "to library" : `${toSave} remaining`} ({toSave})
                            </Button>
                            {failedKeys.length > 0 ? (
                                <Button variant="outline" className={TAP} disabled={!online || run.saving.running}
                                        onClick={() => void startSave("failed")}>
                                    <RefreshCw/> Retry {failedKeys.length} failed
                                </Button>
                            ) : null}
                        </div>

                        {!online ? (
                            <InfoNotice tone="warn">
                                <span className="flex items-start gap-2"><CloudOff className="mt-0.5 size-4 shrink-0"
                                                                                   aria-hidden/> You&apos;re offline. Saving to the library needs a connection; previews and downloads still work.</span>
                            </InfoNotice>
                        ) : null}
                        {editedAfterSave ?
                            <InfoNotice>You changed the list after saving. Codes saved earlier stay in your library;
                                saving again creates the current list as new codes.</InfoNotice> : null}

                        {run.gen.phase === "running" ? (
                            <div className="grid gap-2" role="status">
                                <Progress value={pct}>
                                    <ProgressLabel>Rendering codes…</ProgressLabel>
                                    <ProgressValue/>
                                </Progress>
                                <Button variant="outline" className={cn(TAP, "justify-self-start")}
                                        onClick={run.cancelGenerate}>
                                    <X/> Cancel
                                </Button>
                            </div>
                        ) : null}
                        {run.gen.phase !== "running" && Object.keys(run.gen.errors).length ? (
                            <details
                                className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive"
                                open>
                                <summary
                                    className="cursor-pointer font-medium">{Object.keys(run.gen.errors).length} could
                                    not be rendered
                                </summary>
                                <ul className="mt-1 text-xs">
                                    {Object.entries(run.gen.errors).slice(0, 20).map(([k, e]) => <li
                                        key={k}>Row {base.find((v) => v.row.key === k)?.row.line ?? k}: {e}</li>)}
                                </ul>
                            </details>
                        ) : null}

                        {run.saving.running ? (
                            <div className="grid gap-2" role="status">
                                <Progress value={savePct}>
                                    <ProgressLabel>Saving to your library…</ProgressLabel>
                                    <ProgressValue/>
                                </Progress>
                                <Button variant="outline" className={cn(TAP, "justify-self-start")}
                                        onClick={run.cancelSave}>
                                    <X/> Stop after this batch
                                </Button>
                            </div>
                        ) : savedN > 0 || failedKeys.length > 0 ? (
                            <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span>
                  <strong className="text-emerald-700 dark:text-emerald-400">{savedN} saved</strong>
                    {failedKeys.length ? <>, <strong
                        className="text-destructive">{failedKeys.length} failed</strong> (see the rows below)</> : null}.
                </span>
                                {savedN > 0 ? <Link href="/library"
                                                    className={cn(buttonVariants({variant: "link"}), "h-auto min-h-8 p-0")}>Open
                                    library</Link> : null}
                            </p>
                        ) : null}
                        {current && rendered < incl.length && run.gen.phase !== "running" && rendered > 0 ? (
                            <p className="text-xs text-muted-foreground">{rendered} of {incl.length} rendered so
                                far.</p>
                        ) : null}
                    </div>
                </Step>

                {hasInput ? (
                    <div className="min-w-0 lg:col-span-2">
                        <Step n={3} title="Review rows" id="bulk-rows">
                            <BulkRows views={views} style={cfg.style} busy={downloading !== null}
                                      onDownload={(k) => void downloadOne(k)}/>
                        </Step>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
