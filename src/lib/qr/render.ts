"use client";
import type QRCodeStylingType from "qr-code-styling";
import type {ExportFormat, QrStyle} from "../schema";
import {toStylingOptions} from "./style";

export type RenderInput = { data: string; style: QrStyle; logoUrl?: string | null };

let lib: Promise<typeof QRCodeStylingType> | null = null;
export const loadQrLib = () => (lib ??= import("qr-code-styling").then((m) => m.default));

const compMemo = new Map<string, Promise<string>>();

export function compositeLogo(logoUrl: string | null | undefined, style: QrStyle): Promise<string | null> {
    if (!logoUrl) return Promise.resolve(null);
    const {logo} = style;
    const tint = logo.matchForeground ? (style.gradient.enabled ? style.gradient.from : style.fg) : null;
    if (!logo.background && !tint) return Promise.resolve(logoUrl);
    const key = `${logoUrl.length}:${logoUrl.slice(-32)}:${logo.background}:${logo.padding}:${tint}`;
    let p = compMemo.get(key);
    if (!p) {
        p = new Promise<string>((res) => {
            const img = new Image();
            img.onload = () => {
                const N = 192;
                const c = document.createElement("canvas");
                c.width = c.height = N;
                const ctx = c.getContext("2d");
                if (!ctx) return res(logoUrl);
                const pad = logo.background ? Math.min(0.3, logo.padding / 100) * N + N * 0.04 : 0;
                const box = N - pad * 2;
                const k = Math.min(box / img.naturalWidth, box / img.naturalHeight);
                const w = img.naturalWidth * k;
                const h = img.naturalHeight * k;
                ctx.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
                if (tint) {
                    ctx.globalCompositeOperation = "source-in";
                    ctx.fillStyle = tint;
                    ctx.fillRect(0, 0, N, N);
                }
                if (logo.background) {
                    ctx.globalCompositeOperation = "destination-over";
                    ctx.fillStyle = logo.background;
                    ctx.beginPath();
                    ctx.roundRect(0, 0, N, N, N * 0.18);
                    ctx.fill();
                }
                res(c.toDataURL("image/png"));
            };
            img.onerror = () => res(logoUrl);
            img.src = logoUrl;
        });
        compMemo.set(key, p);
    }
    return p;
}

function forFormat(style: QrStyle, format: ExportFormat): QrStyle {
    return format === "jpeg" && style.transparent ? {...style, transparent: false, bg: "#ffffff"} : style;
}

export async function renderBlob(o: RenderInput & { format: ExportFormat; size?: number }): Promise<Blob> {
    const QR = await loadQrLib();
    const style = forFormat(o.style, o.format);
    const logoUrl = await compositeLogo(o.logoUrl, style);
    const opts = toStylingOptions(o.data, style, {size: o.size ?? style.size, logoUrl});
    const qr = new QR({...opts, type: o.format === "svg" ? "svg" : "canvas"});
    const raw = await qr.getRawData(o.format);
    if (!raw) throw new Error("Could not render QR code");
    return raw as Blob;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
    });
}
