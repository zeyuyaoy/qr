"use client";
import {Loader2, LogOut} from "lucide-react";
import {useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {useStatus} from "@/lib/client/hooks";
import {signOutAndWipe} from "@/lib/client/session";
import {Section} from "./field";

export function AccountSection() {
    const {data} = useStatus();
    const [busy, setBusy] = useState(false);
    const out = async () => {
        setBusy(true);
        try {
            if (!(await signOutAndWipe())) toast.info("You are still signed in.");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Sign out failed");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Section id="account" title="Account">
            <p className="text-sm">Signed in as <strong className="break-all">{data?.user.email ?? "…"}</strong></p>
            <p className="text-xs text-muted-foreground">Signing out also removes this app&apos;s cached library, drafts
                and unsynced changes from this device.</p>
            <Button variant="outline" className="tap" onClick={() => void out()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin"/> : <LogOut/>} Sign out
            </Button>
        </Section>
    );
}
