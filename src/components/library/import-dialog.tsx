"use client";
import {FileUp, Loader2} from "lucide-react";
import {useId, useRef, useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {api, type ImportReport} from "@/lib/client/api";
import {cn} from "@/lib/utils";
import {libraryFromCsv} from "@/lib/library-csv";
import {errMsg, readTextFile, TAP} from "./common";

type Policy = "skip" | "overwrite" | "duplicate";
const POLICIES: { id: Policy; label: string; hint: string }[] = [
    {id: "skip", label: "Skip existing", hint: "Codes whose id already exists are left untouched."},
    {id: "overwrite", label: "Overwrite by id", hint: "Codes with the same id are replaced by the file's version."},
    {id: "duplicate", label: "Import as copies", hint: "Every code is added as a new copy with a new id and slug."},
];

function Report({r, applied}: { r: ImportReport; applied: boolean }) {
    const stat = (label: string, n: number, tone?: "bad") => (
        <div
            className={cn("rounded-lg border p-2 text-center", tone === "bad" && n > 0 && "border-destructive/40 bg-destructive/10")}>
            <dd className="text-lg font-semibold tabular-nums">{n}</dd>
            <dt className="text-xs text-muted-foreground">{label}</dt>
        </div>
    );
    return (
        <div className="grid gap-3" aria-live="polite">
            <p className="text-sm font-medium">{applied ? "Import finished" : "Dry run: nothing has been changed yet"}</p>
            <dl className="grid grid-cols-3 gap-2">
                {stat(applied ? "Created" : "Will create", r.created)}
                {stat(applied ? "Updated" : "Will update", r.updated)}
                {stat("Skipped", r.skipped)}
                {stat("Invalid", r.invalid.length, "bad")}
                {stat("Slug conflicts", r.slugConflicts.length, "bad")}
                {stat("Folders / templates", r.folders + r.templates)}
            </dl>
            {!applied ?
                <p className="text-xs text-muted-foreground">The dry run counts every valid code as new; codes that
                    already exist are resolved by the policy when you import.</p> : null}
            {r.invalid.length ? (
                <details className="rounded-lg border p-2 text-sm" open>
                    <summary className="cursor-pointer font-medium">Invalid entries ({r.invalid.length}) are skipped
                    </summary>
                    <ul className="mt-1 grid max-h-40 gap-1 overflow-y-auto text-xs">
                        {r.invalid.slice(0, 50).map((i) => (
                            <li key={i.index}><span
                                className="font-medium">#{i.index + 1}{i.name ? ` ${i.name}` : ""}</span>: {i.error}
                            </li>
                        ))}
                        {r.invalid.length > 50 ? <li>…and {r.invalid.length - 50} more</li> : null}
                    </ul>
                </details>
            ) : null}
            {r.slugConflicts.length ? (
                <details className="rounded-lg border p-2 text-sm" open>
                    <summary className="cursor-pointer font-medium">Slug conflicts ({r.slugConflicts.length}) are not
                        imported
                    </summary>
                    <p className="mt-1 text-xs text-muted-foreground">These short links are already used by a different
                        code. Choose “Import as copies” to give them new slugs.</p>
                    <ul className="mt-1 grid max-h-32 gap-1 overflow-y-auto font-mono text-xs">
                        {r.slugConflicts.slice(0, 50).map((c) => <li key={c.id}>/r/{c.slug}</li>)}
                    </ul>
                </details>
            ) : null}
        </div>
    );
}

export function ImportDialog({open, onOpenChange, offline, onImported}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    offline: boolean;
    onImported: () => void
}) {
    const fileId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [data, setData] = useState<unknown>(null);
    const [policy, setPolicy] = useState<Policy>("skip");
    const [report, setReport] = useState<ImportReport | null>(null);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState<"dry" | "apply" | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setFileName(null);
        setData(null);
        setReport(null);
        setDone(false);
        setError(null);
        setPolicy("skip");
        if (inputRef.current) inputRef.current.value = "";
    };
    const change = (o: boolean) => {
        if (busy === "apply") return;
        if (!o) reset();
        onOpenChange(o);
    };

    const dry = async (d: unknown, p: Policy) => {
        setBusy("dry");
        setError(null);
        try {
            setReport(await api.library.import(d, {dryRun: true, policy: p}));
        } catch (e) {
            setReport(null);
            setError(errMsg(e));
        } finally {
            setBusy(null);
        }
    };

    const onFile = async (file: File | undefined) => {
        if (!file) return;
        setReport(null);
        setDone(false);
        setError(null);
        try {
            const text = (await readTextFile(file)).replace(/^﻿/, "");
            const parsed: unknown = file.name.toLowerCase().endsWith(".csv") ? libraryFromCsv(text) : JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null) throw new Error("This is not a QR Studio library file.");
            setFileName(file.name);
            setData(parsed);
            await dry(parsed, policy);
        } catch (e) {
            setData(null);
            setFileName(null);
            setError(e instanceof SyntaxError ? "That file is not valid JSON." : errMsg(e));
        }
    };

    const apply = async () => {
        setBusy("apply");
        setError(null);
        try {
            const r = await api.library.import(data, {dryRun: false, policy});
            setReport(r);
            setDone(true);
            toast.success(`Imported: ${r.created} created, ${r.updated} updated, ${r.skipped} skipped`);
            onImported();
        } catch (e) {
            setError(errMsg(e));
        } finally {
            setBusy(null);
        }
    };

    const importable = report ? report.created + report.updated : 0;
    const canApply = report ? importable + report.folders + report.templates > 0 : false;
    return (
        <Dialog open={open} onOpenChange={change}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Import library</DialogTitle>
                    <DialogDescription>Choose a JSON library or CSV with a URL/payload column. CSV restores payloads
                        with default styles and paused dynamic links; JSON also preserves styles and logos. You&apos;ll
                        see what would change before anything is written. Passwords are never imported; previously
                        protected links stay paused until you set a new password.</DialogDescription>
                </DialogHeader>
                {offline ? <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">Importing needs a
                    connection.</p> : null}
                <div className="grid gap-1.5">
                    <label htmlFor={fileId} className="text-sm font-medium">Library file (.json or .csv)</label>
                    <div className="flex flex-wrap items-center gap-2">
                        <input ref={inputRef} id={fileId} type="file" accept="application/json,text/csv,.json,.csv"
                               className="sr-only" disabled={offline || busy !== null || done}
                               onChange={(e) => void onFile(e.target.files?.[0])}/>
                        <Button variant="outline" className={TAP} disabled={offline || busy !== null || done}
                                onClick={() => inputRef.current?.click()}>
                            <FileUp/> {fileName ? "Choose another file" : "Choose file"}
                        </Button>
                        <span
                            className="min-w-0 truncate text-sm text-muted-foreground">{fileName ?? "No file chosen"}</span>
                    </div>
                </div>
                {data !== null && !done ? (
                    <fieldset className="grid gap-1.5" disabled={busy !== null}>
                        <legend className="mb-1 text-sm font-medium">If a code already exists</legend>
                        {POLICIES.map((p) => (
                            <label key={p.id}
                                   className={cn("flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50", policy === p.id && "border-primary bg-primary/5")}>
                                <input
                                    type="radio"
                                    name="import-policy"
                                    className="mt-0.5 size-4 accent-primary"
                                    checked={policy === p.id}
                                    onChange={() => {
                                        setPolicy(p.id);
                                        void dry(data, p.id);
                                    }}
                                />
                                <span>
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.hint}</span>
                </span>
                            </label>
                        ))}
                    </fieldset>
                ) : null}
                {busy === "dry" ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2
                    className="size-4 animate-spin"/> Checking the file…</p> : null}
                {error ? <p role="alert"
                            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
                {report && busy !== "dry" ? <Report r={report} applied={done}/> : null}
                <DialogFooter>
                    <Button variant="outline" className={TAP} disabled={busy === "apply"}
                            onClick={() => change(false)}>{done ? "Close" : "Cancel"}</Button>
                    {!done ? (
                        <Button className={TAP} disabled={offline || !canApply || busy !== null}
                                onClick={() => void apply()}>
                            {busy === "apply" ? <Loader2
                                className="animate-spin"/> : null} Import {importable ? `${importable} ${importable === 1 ? "code" : "codes"}` : ""}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
