"use client";
import {FileUp, Loader2, ShieldAlert} from "lucide-react";
import {useRef, useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {api, type RestoreReport} from "@/lib/client/api";
import {formatDateTime, useOnline} from "@/lib/client/hooks";
import type {RemoteSnapshot} from "@/lib/backup/github";
import {Choice, Field, selectClass} from "./field";

const MAX_FILE = 40 * 1024 * 1024;
type Source = "github" | "file";
type Mode = "merge" | "replace";
type Prefer = "newer" | "snapshot" | "existing";
type Dry = { sig: string; report: RestoreReport };

function Stat({k, v, strong}: { k: string; v: number; strong?: boolean }) {
    return (
        <div className="rounded-lg border p-2">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className={strong && v > 0 ? "text-lg font-semibold text-destructive" : "text-lg font-semibold"}>{v}</dd>
        </div>
    );
}

export function RestorePanel({snapshots, selected, onSelect, timezone, onApplied}: {
    snapshots: RemoteSnapshot[];
    selected: string;
    onSelect: (name: string) => void;
    timezone: string;
    onApplied: () => void
}) {
    const online = useOnline();
    const fileRef = useRef<HTMLInputElement>(null);
    const [source, setSource] = useState<Source>("github");
    const [file, setFile] = useState<{ name: string; text: string } | null>(null);
    const [mode, setMode] = useState<Mode>("merge");
    const [prefer, setPrefer] = useState<Prefer>("newer");
    const [dry, setDry] = useState<Dry | null>(null);
    const [typed, setTyped] = useState("");
    const [busy, setBusy] = useState<"dry" | "apply" | null>(null);
    const [error, setError] = useState("");
    const [prevSel, setPrevSel] = useState(selected);
    if (selected !== prevSel) {
        setPrevSel(selected);
        if (selected) setSource("github");
    }

    const sig = `${source}|${source === "github" ? selected : file?.name}|${source === "file" ? file?.text.length : ""}|${mode}|${prefer}`;
    const current = dry && dry.sig === sig ? dry.report : null;
    const src = source === "github" ? (selected ? {github: selected} : null) : file ? {text: file.text} : null;

    const run = async (dryRun: boolean) => {
        if (!src) return;
        setBusy(dryRun ? "dry" : "apply");
        setError("");
        try {
            const r = await api.backup.restore({
                source: src,
                dryRun,
                mode,
                prefer, ...(!dryRun && mode === "replace" ? {confirm: "replace"} : {})
            });
            if (dryRun) setDry({sig, report: r.report});
            else {
                toast.success(`Restore applied: ${r.report.codes.create} created, ${r.report.codes.update} updated${r.report.codes.delete ? `, ${r.report.codes.delete} removed` : ""}`);
                setDry(null);
                setTyped("");
                onApplied();
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Restore failed";
            setError(msg);
            toast.error(msg);
        } finally {
            setBusy(null);
        }
    };

    const pickFile = async (f: File | undefined) => {
        if (!f) return;
        if (f.size > MAX_FILE) return setError("That file is larger than the 40 MB restore limit.");
        setError("");
        setFile({name: f.name, text: await f.text()});
    };

    const canApply = Boolean(current) && (mode !== "replace" || typed === "replace") && busy === null && online;
    const c = current?.codes;

    return (
        <div className="space-y-4" role="group" aria-labelledby="restore-title">
            <div>
                <h3 id="restore-title" className="scroll-mt-20 text-sm font-medium">Restore</h3>
                <p className="text-sm text-muted-foreground">Pick a snapshot, choose how to combine it with what you
                    have now, and review a dry run. Nothing is written until you apply.</p>
            </div>

            <Choice legend="Source" name="restore-source" value={source} onChange={(v) => setSource(v)} options={[{
                value: "github",
                label: "GitHub snapshot",
                hint: snapshots.length ? `${snapshots.length} available` : "None found"
            }, {value: "file", label: "Upload a file", hint: "An encrypted .json export"}]}/>

            {source === "github" ? (
                <Field label="Snapshot"
                       error={snapshots.length === 0 ? "No snapshots are available. Run a backup first or upload a file." : undefined}>
                    {(a) => (
                        <select {...a} className={selectClass} value={selected}
                                onChange={(e) => onSelect(e.target.value)} disabled={snapshots.length === 0}>
                            <option value="">Choose a snapshot…</option>
                            {snapshots.map((s) => <option key={s.name}
                                                          value={s.name}>{formatDateTime(s.createdAt, timezone)} ({(s.size / 1024).toFixed(0)} KB)</option>)}
                        </select>
                    )}
                </Field>
            ) : (
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="outline" className="tap"
                            onClick={() => fileRef.current?.click()}><FileUp/> Choose backup file</Button>
                    <span className="text-sm text-muted-foreground">{file ? file.name : "No file chosen"}</span>
                    <Input ref={fileRef} type="file" accept=".json,application/json" className="sr-only"
                           aria-label="Encrypted backup file" tabIndex={-1} onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        void pickFile(f);
                    }}/>
                </div>
            )}

            <Choice legend="Mode" name="restore-mode" value={mode} onChange={(v) => setMode(v)} options={[{
                value: "merge",
                label: "Merge",
                hint: "Add and update codes from the snapshot. Never deletes anything."
            }, {
                value: "replace",
                label: "Replace",
                hint: "Make the library match the snapshot. Codes created after it are deleted."
            }]}/>

            <Choice legend="If a code exists in both and differs" name="restore-prefer" value={prefer}
                    onChange={(v) => setPrefer(v)} options={[{
                value: "newer",
                label: "Keep the newer",
                hint: "By last-edited time"
            }, {value: "snapshot", label: "Use the snapshot"}, {value: "existing", label: "Keep what I have"}]}/>

            <Button type="button" variant="outline" className="tap" onClick={() => void run(true)}
                    disabled={!src || busy !== null || !online}>
                {busy === "dry" ? <Loader2 className="animate-spin"/> : null} Preview restore (dry run)
            </Button>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {current && c && (
                <div className="space-y-3 rounded-xl border p-4" aria-live="polite">
                    <h4 className="font-medium">Dry run result</h4>
                    <p className="text-sm">Snapshot
                        taken <strong>{formatDateTime(current.snapshotCreatedAt, timezone)}</strong>. {current.metaWillBeCreated ? "The library is not initialised and will be after restore." : null}
                    </p>
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat k="Will create" v={c.create}/>
                        <Stat k="Will update" v={c.update}/>
                        <Stat k="Unchanged" v={c.unchanged}/>
                        <Stat k="Kept (yours is newer)" v={c.keptExisting}/>
                        <Stat k="Will delete" v={c.delete} strong/>
                        <Stat k="Slug conflicts" v={c.slugConflicts}/>
                        <Stat k="Invalid in snapshot" v={c.invalid}/>
                        <Stat k="Folders / templates" v={current.folders + current.templates}/>
                    </dl>
                    <div
                        className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600"/>
                        <p>Changes made after {formatDateTime(current.snapshotCreatedAt, timezone)} are not in this
                            snapshot and will be
                            lost{mode === "replace" ? ": codes created later are deleted and later edits are reverted" : " wherever the snapshot version wins"}.</p>
                    </div>
                    {c.slugConflicts > 0 &&
                        <p className="text-sm">Codes whose short link is already used by another code are skipped, so
                            they are not restored.</p>}
                    {current.conflicts.length > 0 && (
                        <details className="text-sm">
                            <summary
                                className="tap flex cursor-pointer items-center font-medium">{current.conflicts.length} conflict{current.conflicts.length === 1 ? "" : "s"}</summary>
                            <ul className="max-h-48 space-y-1 overflow-auto pl-1">
                                {current.conflicts.slice(0, 100).map((x) => <li key={`${x.id}-${x.reason}`}><span
                                    className="font-medium">{x.name}</span> <span
                                    className="text-muted-foreground">{x.reason}</span></li>)}
                            </ul>
                            {current.conflicts.length > 100 &&
                                <p className="mt-1 text-xs text-muted-foreground">Showing the first 100.</p>}
                        </details>
                    )}
                    {mode === "replace" && (
                        <Field label='Type "replace" to allow deleting codes that are not in the snapshot'
                               error={typed && typed !== "replace" ? 'Type exactly "replace".' : undefined}>
                            {(a) => <Input {...a} className="h-11" value={typed}
                                           onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                                           autoCapitalize="none" spellCheck={false}/>}
                        </Field>
                    )}
                    <Button type="button" variant="destructive" className="tap" onClick={() => void run(false)}
                            disabled={!canApply}>
                        {busy === "apply" ? <Loader2 className="animate-spin"/> : null} Apply restore
                    </Button>
                </div>
            )}
            {dry && !current &&
                <p className="text-sm text-muted-foreground">You changed the options, so the last dry run no longer
                    applies. Preview again to enable restore.</p>}
        </div>
    );
}
