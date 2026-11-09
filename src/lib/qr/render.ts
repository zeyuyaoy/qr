"use client";
import type QRCodeStylingType from "qr-code-styling";
import type {ExportFormat, QrStyle} from "../schema";
import {toStylingOptions} from "./style";

export type RenderInput = { data: string; style: QrStyle; logoUrl?: string | null };

let lib: Promise<typeof QRCodeStylingType> | null = null;
export const loadQrLib = () => (lib ??= import("qr-code-styling").then((m) => m.default));

const compMemo = new Map<string, Promise<string>>();

export function compositeLogo(logoUrl: string | null | undefined, logo: QrStyle["logo"]): Promise<string | null> {
    if (!logoUrl) return Promise.resolve(null);
    if (!logo.background) return Promise.resolve(logoUrl);
    const key = `${logoUrl.length}:${logoUrl.slice(-32)}:${logo.background}:${logo.padding}`;
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
                ctx.fillStyle = logo.background!;
                const r = N * 0.18;
                ctx.beginPath();
                ctx.roundRect(0, 0, N, N, r);
                ctx.fill();
                const pad = Math.min(0.3, logo.padding / 100) * N + N * 0.04;
                const box = N - pad * 2;
                const k = Math.min(box / img.naturalWidth, box / img.naturalHeight);
                const w = img.naturalWidth * k;
                const h = img.naturalHeight * k;
                ctx.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
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
    const logoUrl = await compositeLogo(o.logoUrl, style.logo);
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
