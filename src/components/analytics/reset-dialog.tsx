"use client";
import {Loader2, RotateCcw} from "lucide-react";
import {useRef, useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {api} from "@/lib/client/api";

export function ResetAnalyticsDialog({id, disabled, onDone}: { id?: string; disabled?: boolean; onDone: () => void }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const scope = id ? "this code" : "every code";
    const ready = text.trim().toLowerCase() === "reset";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ready || busy) return;
        setBusy(true);
        try {
            const {deleted} = await api.analytics.reset(id);
            toast.success(`Analytics reset (${deleted.toLocaleString()} counters removed)`);
            setOpen(false);
            onDone();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Reset failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => {
            setOpen(o);
            if (!o) setText("");
        }}>
            <DialogTrigger render={<Button variant="destructive" className="tap" disabled={disabled}/>}>
                <RotateCcw/> Reset analytics
            </DialogTrigger>
            <DialogContent initialFocus={inputRef}>
                <form onSubmit={submit} className="grid gap-4">
                    <DialogHeader>
                        <DialogTitle>Reset analytics for {scope}?</DialogTitle>
                        <DialogDescription>
                            This permanently deletes the scan history, device and country counts, and the scan counters
                            for {scope}. Codes that have a scan limit start counting from zero again. This cannot be
                            undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2">
                        <Label htmlFor={`reset-confirm-${id ?? "all"}`}>Type <span className="font-mono">reset</span> to
                            confirm</Label>
                        <Input ref={inputRef} id={`reset-confirm-${id ?? "all"}`} value={text}
                               onChange={(e) => setText(e.target.value)} autoComplete="off" autoCapitalize="none"
                               spellCheck={false} className="h-11"/>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" className="tap"
                                onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit" variant="destructive" className="tap" disabled={!ready || busy}>
                            {busy ? <Loader2 className="animate-spin"/> : null} Delete analytics
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
