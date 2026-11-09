"use client";
import {Loader2, Pencil, Trash2} from "lucide-react";
import {useCallback, useEffect, useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {api} from "@/lib/client/api";
import {tagSchema} from "@/lib/schema";
import {errMsg, ErrorNotice, TAP} from "./common";

type TagRow = { tag: string; count: number };

function Row({row, all, disabled, onChanged}: {
    row: TagRow;
    all: TagRow[];
    disabled: boolean;
    onChanged: () => void
}) {
    const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
    const [value, setValue] = useState(row.tag);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const parsed = tagSchema.safeParse(value);
    const target = parsed.success ? parsed.data : null;
    const merging = target !== null && target !== row.tag && all.some((t) => t.tag === target);
    const fieldError = !parsed.success && value ? (parsed.error.issues[0]?.message ?? "Invalid tag") : undefined;

    const run = async (to: string | null, ok: string) => {
        setBusy(true);
        setError(null);
        try {
            const {updated} = await api.tags.rename(row.tag, to);
            toast.success(`${ok} (${updated} ${updated === 1 ? "code" : "codes"} updated)`);
            setMode("view");
            onChanged();
        } catch (e) {
            setError(errMsg(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="rounded-xl border p-2.5">
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.tag}</p>
                    <p className="text-xs text-muted-foreground">{row.count} {row.count === 1 ? "code" : "codes"}</p>
                </div>
                <Button variant="ghost" size="icon" className="tap" aria-label={`Rename or merge tag ${row.tag}`}
                        disabled={disabled}
                        onClick={() => setMode(mode === "edit" ? "view" : "edit")}><Pencil/></Button>
                <Button variant="ghost" size="icon" className="tap" aria-label={`Delete tag ${row.tag}`}
                        disabled={disabled}
                        onClick={() => setMode(mode === "delete" ? "view" : "delete")}><Trash2/></Button>
            </div>
            {mode === "edit" ? (
                <form
                    className="mt-2 grid gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (target && target !== row.tag) void run(target, merging ? "Tags merged" : "Tag renamed");
                    }}
                >
                    <label className="grid gap-1 text-sm font-medium">
                        New name
                        <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={32} className="h-10"
                               autoFocus aria-invalid={fieldError ? true : undefined}/>
                    </label>
                    {fieldError ? <p role="alert" className="text-xs text-destructive">{fieldError}</p> : null}
                    {merging ?
                        <p className="text-xs text-muted-foreground">A tag named “{target}” already exists. Saving
                            merges both into it.</p> : null}
                    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
                    <div className="flex gap-2">
                        <Button type="submit" className={TAP} disabled={busy || !target || target === row.tag}>
                            {busy ? <Loader2 className="animate-spin"/> : null} {merging ? "Merge" : "Rename"}
                        </Button>
                        <Button type="button" variant="outline" className={TAP} disabled={busy} onClick={() => {
                            setMode("view");
                            setValue(row.tag);
                            setError(null);
                        }}>Cancel</Button>
                    </div>
                </form>
            ) : null}
            {mode === "delete" ? (
                <div className="mt-2 grid gap-2 rounded-lg bg-destructive/10 p-2.5 text-sm" role="group"
                     aria-label={`Confirm deleting tag ${row.tag}`}>
                    <p>Remove “{row.tag}” from all {row.count} {row.count === 1 ? "code" : "codes"}? The codes
                        themselves are not deleted.</p>
                    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
                    <div className="flex gap-2">
                        <Button variant="destructive" className={TAP} disabled={busy}
                                onClick={() => void run(null, "Tag deleted")}>
                            {busy ? <Loader2 className="animate-spin"/> : null} Delete tag
                        </Button>
                        <Button variant="outline" className={TAP} disabled={busy}
                                onClick={() => setMode("view")}>Keep</Button>
                    </div>
                </div>
            ) : null}
        </li>
    );
}

export function TagDialog({open, onOpenChange, offline, onChanged}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    offline: boolean;
    onChanged: () => void
}) {
    const [tags, setTags] = useState<TagRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const load = useCallback(() => setTick((n) => n + 1), []);
    useEffect(() => {
        if (!open) return;
        let alive = true;
        api.tags.list().then(
            (l) => alive && (setTags(l), setError(null)),
            (e) => alive && setError(errMsg(e)),
        );
        return () => {
            alive = false;
        };
    }, [open, tick]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Manage tags</DialogTitle>
                    <DialogDescription>Rename a tag everywhere, merge it into another, or remove it. Renaming to an
                        existing tag merges them.</DialogDescription>
                </DialogHeader>
                {offline ?
                    <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">Tags can only be changed
                        while online.</p> : null}
                {error ? (
                    <ErrorNotice title="Could not load tags" message={error} onRetry={load}/>
                ) : !tags ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2
                        className="size-4 animate-spin"/> Loading tags…</p>
                ) : tags.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tags yet. Add tags to codes from the editor or the
                        bulk actions bar.</p>
                ) : (
                    <ul className="grid gap-2" aria-label="Tags">
                        {tags.map((t) => (
                            <Row
                                key={t.tag}
                                row={t}
                                all={tags}
                                disabled={offline}
                                onChanged={() => {
                                    load();
                                    onChanged();
                                }}
                            />
                        ))}
                    </ul>
                )}
            </DialogContent>
        </Dialog>
    );
}
