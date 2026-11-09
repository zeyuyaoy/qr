"use client";
import {signOut} from "next-auth/react";
import {drafts, library, queue, settingsCache} from "./offline";

export async function wipeLocalPrivateData() {
    await library.clear();
    void drafts;
    void settingsCache;
    try {
        for (const key of Object.keys(localStorage)) if (key.startsWith("qr.library.")) localStorage.removeItem(key);
        const reg = await navigator.serviceWorker?.getRegistration();
        reg?.active?.postMessage({type: "clear-private"});
        if ("caches" in window) for (const k of await caches.keys()) if (k.startsWith("qr-pages") || k.startsWith("qr-private")) await caches.delete(k);
    } catch {
    }
}

export async function signOutAndWipe(): Promise<boolean> {
    const pending = (await queue.list()).filter((o) => o.status === "pending").length;
    if (pending && !window.confirm(`${pending} change(s) have not synced yet and will be lost if you sign out now. Sign out anyway?`)) return false;
    await wipeLocalPrivateData();
    await signOut({callbackUrl: "/login"});
    return true;
}
