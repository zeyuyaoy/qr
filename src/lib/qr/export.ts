"use client";
import { zipSync } from "fflate";
import type { ExportFormat } from "../schema";

const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** `{name}`, `{type}`, `{slug}` placeholders → safe filename + extension. */
export function makeFilename(template: string, vars: { name: string; type?: string; slug?: string | null }, ext: ExportFormat | string): string {
  const base = (template || "{name}")
    .replace(/\{name\}/g, vars.name)
    .replace(/\{type\}/g, vars.type ?? "")
    .replace(/\{slug\}/g, vars.slug ?? "");
  const clean = base.replace(UNSAFE, "-").replace(/\s+/g, " ").replace(/^[.\s-]+|[.\s-]+$/g, "").slice(0, 80);
  return `${clean || "qr-code"}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type CopyResult = "copied" | "unsupported" | "denied";
/** Copy a PNG to the clipboard. Accepts a promise so Safari keeps the user-gesture. */
export async function copyImage(png: Blob | Promise<Blob>): Promise<CopyResult> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return "unsupported";
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": Promise.resolve(png) })]);
    return "copied";
  } catch (e) {
    return e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "unsupported";
  }
}

export type ShareResult = "shared" | "unsupported" | "cancelled";
export async function shareFile(blob: Blob, filename: string, o: { title?: string; text?: string; url?: string } = {}): Promise<ShareResult> {
  if (typeof navigator.share !== "function") return "unsupported";
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: o.title, text: o.text });
    else if (o.url) await navigator.share({ title: o.title, text: o.text, url: o.url });
    else return "unsupported";
    return "shared";
  } catch (e) {
    return e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "unsupported";
  }
}

/** Store-only ZIP (PNG/JPEG/WebP are already compressed). Duplicate names get a numeric suffix. */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const used = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    let name = f.name;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = f.name.replace(/(\.[^.]+)?$/, `-${i}$1`);
    used.add(name.toLowerCase());
    entries[name] = new Uint8Array(await f.blob.arrayBuffer());
  }
  const zipped = zipSync(entries, { level: 0 });
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Print one or many QR images using a hidden iframe (no pop-ups to block). */
export function printHtml(title: string, items: { name: string; dataUrl: string }[]): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  const single = items.length === 1;
  doc.open();
  doc.write(`<!doctype html><title>${esc(title)}</title><style>
    @page{margin:12mm}body{font:14px system-ui,sans-serif;margin:0;color:#111}
    .g{display:grid;grid-template-columns:repeat(${single ? 1 : 3},1fr);gap:10mm}
    figure{margin:0;break-inside:avoid;text-align:center}img{width:100%;max-width:${single ? "120mm" : "55mm"};height:auto}
    figcaption{margin-top:2mm;font-size:12px;word-break:break-word}
  </style><div class="g">${items.map((i) => `<figure><img src="${i.dataUrl}" alt=""><figcaption>${esc(i.name)}</figcaption></figure>`).join("")}</div>`);
  doc.close();
  const imgs = [...doc.images];
  void Promise.all(imgs.map((im) => (im.complete ? 0 : new Promise((r) => ((im.onload = im.onerror = r))))))
    .then(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    })
    .finally(() => setTimeout(() => iframe.remove(), 60_000));
}
