"use client";
import { Download, Share } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Install guidance: native prompt where supported (Chromium), manual steps on iOS Safari. Hidden once installed. */
export function InstallHint() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
    const onPrompt = (e: Event) => (e.preventDefault(), setEvt(e as BIPEvent));
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => (window.removeEventListener("beforeinstallprompt", onPrompt), window.removeEventListener("appinstalled", onInstalled));
  }, []);
  if (installed || (!evt && !ios)) return null;
  return (
    <div className="rounded-lg border p-2 text-xs">
      <Button size="sm" variant="outline" className="w-full" onClick={() => (evt ? void evt.prompt() : setOpen((v) => !v))}>
        <Download /> Install app
      </Button>
      {open && ios && (
        <p className="mt-2 text-muted-foreground">
          Tap <Share className="inline size-3.5" /> Share, then <strong>Add to Home Screen</strong>.
        </p>
      )}
    </div>
  );
}
