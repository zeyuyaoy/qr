"use client";
import {ImageUp, Loader2} from "lucide-react";
import {useState} from "react";
import {cn} from "@/lib/utils";
import {decodeImageFile} from "./decode";

export function ImageScanner({onResult}: { onResult: (text: string) => void }) {
    const [over, setOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");

    const handle = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) return setMsg("That file is not an image. Choose a PNG, JPEG, WebP or similar picture.");
        setBusy(true);
        setMsg("");
        try {
            const text = await decodeImageFile(file);
            if (text) onResult(text);
            else setMsg("No QR code was found in this image. Use a sharp picture where the whole code is visible, with its white border, then try again.");
        } catch {
            setMsg("This image could not be read. Try a different file or format.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-2">
            <label
                onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    void handle(e.dataTransfer.files[0]);
                }}
                className={cn("tap flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-center text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/50", over && "border-ring bg-muted")}
            >
                {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground"/> :
                    <ImageUp className="size-4 text-muted-foreground"/>}
                <span className="font-medium">{busy ? "Reading image…" : "Upload an image"}</span>
                <input
                    aria-label="Upload an image"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        void handle(f);
                    }}
                />
            </label>
            <p role="status" aria-live="polite"
               className={cn("text-sm text-muted-foreground", !msg && "sr-only")}>{msg}</p>
        </div>
    );
}
