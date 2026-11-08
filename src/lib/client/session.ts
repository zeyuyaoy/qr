"use client";
import { signOut } from "next-auth/react";
import { drafts, library, queue, settingsCache } from "./offline";

/** Remove everything private from this browser: IndexedDB copies and the service worker's page cache. */
export async function wipeLocalPrivateData() {
  await library.clear(); // clears every key in the store: library, settings, drafts, queue
  void drafts;
  void settingsCache;
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("qr.library.")) localStorage.removeItem(key);
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.active?.postMessage({ type: "clear-private" });
    if ("caches" in window) for (const k of await caches.keys()) if (k.startsWith("qr-pages") || k.startsWith("qr-private")) await caches.delete(k);
  } catch {
    /* best effort */
  }
}

/** Sign out. Warns first if offline changes have not been synced, because wiping would lose them. */
export async function signOutAndWipe(): Promise<boolean> {
  const pending = (await queue.list()).filter((o) => o.status === "pending").length;
  if (pending && !window.confirm(`${pending} change(s) have not synced yet and will be lost if you sign out now. Sign out anyway?`)) return false;
  await wipeLocalPrivateData();
  await signOut({ callbackUrl: "/login" });
  return true;
}
