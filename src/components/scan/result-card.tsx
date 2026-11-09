"use client";
import {Check, Copy, ExternalLink, Eye, EyeOff, Loader2, Save, ScanLine, Shapes, TriangleAlert} from "lucide-react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useMemo, useState} from "react";
import {toast} from "sonner";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {useSettings} from "@/lib/client/hooks";
import {saveNew} from "@/lib/client/offline";
import {parseScanned} from "@/lib/qr/parse";
import {SENSITIVE_TYPES} from "@/lib/schema";
import {analyzeUrl} from "./decode";

async function copyText(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        try {
            return document.execCommand("copy");
        } finally {
            ta.remove();
        }
    }
}

const maskWifi = (raw: string) => raw.replace(/(^|;)(P:)((?:\\.|[^;])*)/i, "$1$2••••••••");

export function ResultCard({raw, headingRef, onScanAgain}: {
    raw: string;
    headingRef: React.Ref<HTMLHeadingElement>;
    onScanAgain: () => void
}) {
    const router = useRouter();
    const {settings} = useSettings();
    const parsed = useMemo(() => parseScanned(raw), [raw]);
    const link = useMemo(() => analyzeUrl(raw), [raw]);
    const [reveal, setReveal] = useState(false);
    const [copied, setCopied] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedId, setSavedId] = useState<string | null>(null);

    const isWifi = parsed.type === "wifi";
    const password = isWifi && typeof parsed.fields.password === "string" ? parsed.fields.password : "";
    const shownRaw = isWifi && !reveal ? maskWifi(raw) : raw;
    const sensitiveSave = SENSITIVE_TYPES.includes(parsed.type);

    const copy = async () => {
        if (await copyText(raw)) {
            setCopied(true);
            toast.success("Copied to clipboard");
            window.setTimeout(() => setCopied(false), 2000);
        } else toast.error("Copy failed. Select the text and copy it manually.");
    };

    const save = async () => {
        setSaving(true);
        try {
            const label = link?.host ?? raw.replace(/\s+/g, " ").slice(0, 30);
            const {view, queued} = await saveNew({
                name: `Scanned: ${label}`.slice(0, 120),
                type: parsed.type,
                mode: "static",
                fields: parsed.fields,
                payload: raw,
                style: settings.defaultStyle
            });
            setSavedId(view.id);
            if (queued) toast.success("Saved on this device. It will sync when you are back online.");
            else toast.success("Saved to your library", {
                action: {
                    label: "Open",
                    onClick: () => router.push(`/library/${view.id}`)
                }
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Could not save";
            toast.error(msg, {description: sensitiveSave ? "Wi-Fi and contact codes can only be saved when the server has an encryption key (DATA_ENCRYPTION_KEY) configured." : undefined});
        } finally {
            setSaving(false);
        }
    };

    return (
        <section aria-labelledby="scan-result-title"
                 className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="scan-result-title" ref={headingRef} tabIndex={-1}
                    className="text-lg font-semibold outline-none">Scanned: {parsed.label}</h2>
                <Badge variant="secondary">{parsed.type}</Badge>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {parsed.summary.map((row, i) => (
                    <div key={`${row.label}-${i}`} className="col-span-2 grid grid-cols-subgrid">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd className="min-w-0 break-words">{isWifi && row.label === "Password" && reveal ? password : row.value}</dd>
                    </div>
                ))}
            </dl>

            {isWifi && password && (
                <Button variant="outline" className="tap" aria-pressed={reveal} onClick={() => setReveal((v) => !v)}>
                    {reveal ? <EyeOff/> : <Eye/>} {reveal ? "Hide password" : "Reveal password"}
                </Button>
            )}

            <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Raw content</p>
                <pre
                    className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs">{shownRaw}</pre>
            </div>

            {link && link.warnings.length > 0 && (
                <div role="alert"
                     className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600"/>
                    <ul className="space-y-1">{link.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="tap" onClick={() => void copy()}>{copied ? <Check/> :
                    <Copy/>} Copy</Button>
                {link &&
                    <Button variant="outline" className="tap" onClick={() => setConfirmOpen(true)}><ExternalLink/> Open
                        link…</Button>}
                <Button variant="outline" className="tap"
                        onClick={() => router.push(`/?content=${encodeURIComponent(raw)}`)}><Shapes/> Recreate</Button>
                {savedId ? (
                    <Link href={`/library/${savedId}`}
                          className="tap inline-flex items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium underline-offset-4 hover:underline"><Check
                        className="size-4"/> Saved. View in library</Link>
                ) : (
                    <Button className="tap" onClick={() => void save()} disabled={saving}>{saving ?
                        <Loader2 className="animate-spin"/> : <Save/>} Save to library</Button>
                )}
                <Button variant="ghost" className="tap" onClick={onScanAgain}><ScanLine/> Scan another</Button>
            </div>
            {sensitiveSave && !savedId &&
                <p className="text-xs text-muted-foreground">Saving {parsed.label.toLowerCase()} codes requires the
                    server to have encryption (sealing) configured, because they contain private details. If it is not,
                    saving will fail with a clear message.</p>}

            {link && (
                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Open this link?</DialogTitle>
                            <DialogDescription>A QR code can point anywhere. Check the address before you continue. It
                                opens in a new tab.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 text-sm">
                            <div>
                                <p className="text-xs font-medium text-muted-foreground">Website (host)</p>
                                <p className="break-all font-mono font-semibold">{link.host}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-muted-foreground">Full address</p>
                                <p className="max-h-32 overflow-auto break-all rounded-lg bg-muted p-2 font-mono text-xs">{link.url}</p>
                            </div>
                            {link.warnings.length > 0 && (
                                <div role="alert"
                                     className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
                                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600"/>
                                    <ul className="space-y-1">{link.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                                </div>
                            )}
                        </div>
                        <DialogFooter>
                            <Button variant="outline" className="tap"
                                    onClick={() => setConfirmOpen(false)}>Cancel</Button>
                            <Button className="tap" onClick={() => {
                                window.open(link.url, "_blank", "noopener,noreferrer");
                                setConfirmOpen(false);
                            }}>
                                <ExternalLink/> Open link
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </section>
    );
}
