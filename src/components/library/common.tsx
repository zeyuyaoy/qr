"use client";
import {Loader2, TriangleAlert} from "lucide-react";
import {useEffect, useState} from "react";
import {Button} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {cn} from "@/lib/utils";

export const TAP = "min-h-11 md:min-h-8";

export const errMsg = (e: unknown, fallback = "Something went wrong") => (e instanceof Error && e.message ? e.message : fallback);

export function useDebounced<T>(value: T, ms = 200): T {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return v;
}

export function Skeleton({className}: { className?: string }) {
    return <div aria-hidden className={cn("animate-pulse rounded-lg bg-muted", className)}/>;
}

export function ErrorNotice({title = "Something went wrong", message, onRetry, className}: {
    title?: string;
    message: string;
    onRetry?: () => void;
    className?: string
}) {
    return (
        <div role="alert"
             className={cn("flex flex-wrap items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive", className)}>
            <TriangleAlert className="mt-0.5 size-4 shrink-0"/>
            <div className="min-w-0 flex-1">
                <p className="font-medium">{title}</p>
                <p className="break-words opacity-90">{message}</p>
            </div>
            {onRetry ? (
                <Button variant="outline" className={TAP} onClick={onRetry}>
                    Try again
                </Button>
            ) : null}
        </div>
    );
}

export function InfoNotice({children, className, tone = "info"}: {
    children: React.ReactNode;
    className?: string;
    tone?: "info" | "warn"
}) {
    return (
        <div role="status"
             className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-sm", tone === "warn" ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-muted/60 text-muted-foreground", className)}>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

export function ConfirmDialog({
                                  open,
                                  onOpenChange,
                                  title,
                                  description,
                                  confirmLabel,
                                  destructive = true,
                                  onConfirm,
                              }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    destructive?: boolean;
    onConfirm: () => Promise<void> | void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const change = (o: boolean) => {
        if (busy) return;
        if (!o) setError(null);
        onOpenChange(o);
    };
    return (
        <Dialog open={open} onOpenChange={change}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                    <Button variant="outline" className={TAP} disabled={busy} onClick={() => change(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant={destructive ? "destructive" : "default"}
                        className={TAP}
                        disabled={busy}
                        onClick={async () => {
                            setBusy(true);
                            setError(null);
                            try {
                                await onConfirm();
                                setBusy(false);
                                onOpenChange(false);
                            } catch (e) {
                                setBusy(false);
                                setError(errMsg(e));
                            }
                        }}
                    >
                        {busy ? <Loader2 className="animate-spin"/> : null}
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export async function readTextFile(file: File, maxBytes = 20 * 1024 * 1024): Promise<string> {
    if (file.size > maxBytes) throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    return file.text();
}

export async function inBatches<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>, shouldStop: () => boolean = () => false): Promise<void> {
    for (let i = 0; i < items.length && !shouldStop(); i += limit) {
        await Promise.all(items.slice(i, i + limit).map((it, j) => fn(it, i + j)));
        await new Promise((r) => setTimeout(r, 0));
    }
}
