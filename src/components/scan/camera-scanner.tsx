"use client";
import { Camera, CameraOff, Loader2, ShieldAlert, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createVideoDecoder } from "./decode";

type CamState = "idle" | "requesting" | "scanning" | "denied" | "unavailable" | "insecure" | "error";
const FRAME_MS = 100; // ~10 fps

const MESSAGES: Record<Exclude<CamState, "idle" | "scanning" | "requesting">, { title: string; body: string }> = {
  denied: { title: "Camera permission was denied", body: "Allow camera access for this site in your browser or system settings, then try again. You can also upload a photo of the code instead." },
  unavailable: { title: "No usable camera found", body: "This device has no camera, or another app is using it. You can upload an image of the code instead." },
  insecure: { title: "The camera needs a secure connection", body: "Browsers only allow camera access on HTTPS pages (or localhost). Open this app through its https:// address, or upload an image instead." },
  error: { title: "The camera could not be started", body: "Something went wrong while starting the camera. Try again, or upload an image instead." },
};

export function CameraScanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number>(0);
  const runRef = useRef(0);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });
  const [state, setState] = useState<CamState>("idle");
  const [note, setNote] = useState("");

  /** Release the camera hardware: cancel the loop, stop every track, detach the stream. */
  const release = useCallback(() => {
    runRef.current++;
    window.clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback((msg = "") => {
    release();
    setNote(msg);
    setState("idle");
  }, [release]);

  const start = async () => {
    setNote("");
    if (!window.isSecureContext) return setState("insecure");
    if (!navigator.mediaDevices?.getUserMedia) return setState("unavailable");
    release();
    const run = ++runRef.current;
    const stale = () => runRef.current !== run;
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (stale()) return stream.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return release();
      video.srcObject = stream;
      await video.play();
      if (stale()) return;
      const decode = await createVideoDecoder();
      if (stale()) return;
      setState("scanning");
      const loop = async () => {
        if (stale()) return;
        let text: string | null = null;
        if (!document.hidden && video.readyState >= 2 && video.videoWidth > 0) {
          try {
            text = await decode(video);
          } catch {
            /* a single bad frame is not fatal */
          }
        }
        if (stale()) return;
        if (text) {
          navigator.vibrate?.(40);
          stop();
          onResultRef.current(text);
          return;
        }
        timerRef.current = window.setTimeout(() => void loop(), FRAME_MS);
      };
      void loop();
    } catch (e) {
      if (stale()) return;
      release();
      const name = e instanceof DOMException ? e.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError" ? "unavailable" : "error");
    }
  };

  // Never leave the camera running when the page is hidden or the component goes away.
  useEffect(() => {
    const hide = () => {
      if (document.hidden && streamRef.current) stop("The camera was stopped because the page was hidden.");
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", release);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [release, stop]);

  const scanning = state === "scanning";
  const problem = state in MESSAGES ? MESSAGES[state as keyof typeof MESSAGES] : null;

  return (
    <div className="space-y-3">
      <div className={cn("relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted", !scanning && state !== "requesting" && "grid place-items-center")}>
        <video ref={videoRef} playsInline muted aria-label="Camera preview" className={cn("size-full object-cover", !scanning && "hidden")} />
        {scanning && <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />}
        {state === "requesting" && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Waiting for camera permission…</div>}
        {state === "idle" && <div className="px-6 text-center text-sm text-muted-foreground"><Camera className="mx-auto mb-2 size-8 opacity-60" />Point your camera at a QR code. Nothing is uploaded: decoding happens on this device.</div>}
        {problem && <div className="px-6 text-center text-sm"><CameraOff className="mx-auto mb-2 size-8 text-muted-foreground" /><p className="font-medium">{problem.title}</p><p className="mt-1 text-muted-foreground">{problem.body}</p></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {scanning ? (
          <Button variant="outline" className="tap" onClick={() => stop()}><Square /> Stop camera</Button>
        ) : (
          <Button className="tap" onClick={() => void start()} disabled={state === "requesting"}>
            {state === "requesting" ? <Loader2 className="animate-spin" /> : <Camera />} {problem ? "Try again" : "Start camera"}
          </Button>
        )}
      </div>
      <p role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", !scanning && !note && "sr-only")}>
        {note && <ShieldAlert className="size-4 shrink-0" />}
        {scanning ? "Scanning… hold the code steady inside the frame." : note}
      </p>
    </div>
  );
}
