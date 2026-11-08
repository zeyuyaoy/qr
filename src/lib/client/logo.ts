"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { assetCache } from "./offline";

export const MAX_LOGO_BYTES = 12 * 1024;
const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const OK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

const memo = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** Resolve a logo asset id to a data URL: memory → IndexedDB → server. Works offline once seen. */
export function resolveLogoUrl(assetId: string | null | undefined): Promise<string | null> {
  if (!assetId) return Promise.resolve(null);
  const hit = memo.get(assetId);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(assetId);
  if (!p) {
    p = (async () => {
      const local = await assetCache.get(assetId);
      if (local) return local;
      try {
        const { dataUrl } = await api.assets.get(assetId);
        await assetCache.set(assetId, dataUrl);
        return dataUrl;
      } catch {
        return null;
      }
    })().then((u) => {
      if (u) memo.set(assetId, u);
      inflight.delete(assetId);
      return u;
    });
    inflight.set(assetId, p);
  }
  return p;
}

export function useLogoUrl(assetId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(assetId ? (memo.get(assetId) ?? null) : null);
  useEffect(() => {
    let alive = true;
    if (!assetId) return setUrl(null);
    void resolveLogoUrl(assetId).then((u) => alive && setUrl(u));
    return () => void (alive = false);
  }, [assetId]);
  return url;
}

const decodedBytes = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

/**
 * Validate + sanitise a logo entirely in the browser. Whatever the input (including SVG), the output is a
 * small raster image: scripts, external references and metadata cannot survive rasterisation.
 * Returns the data URL and its content-hash id (identical to the server's id, so it works offline).
 */
export async function processLogoFile(file: File): Promise<{ dataUrl: string; assetId: string }> {
  if (!OK_TYPES.includes(file.type)) throw new Error("Use a PNG, JPEG, WebP or SVG image");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Image is larger than 3 MB");
  const objUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not read that image"));
      i.src = objUrl;
    });
    const w0 = img.naturalWidth || 256;
    const h0 = img.naturalHeight || 256;
    for (const edge of [192, 160, 128, 96, 64]) {
      const scale = Math.min(edge / w0, edge / h0, 1);
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser");
      ctx.drawImage(img, 0, 0, w, h);
      for (const [type, q] of [["image/webp", 0.92], ["image/webp", 0.8], ["image/webp", 0.6], ["image/png", undefined]] as const) {
        const dataUrl = canvas.toDataURL(type, q);
        if (!dataUrl.startsWith(`data:${type}`)) continue; // browser lacks WebP encoding → try PNG
        if (decodedBytes(dataUrl) <= MAX_LOGO_BYTES) {
          const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const assetId = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
          await assetCache.set(assetId, dataUrl);
          memo.set(assetId, dataUrl);
          return { dataUrl, assetId };
        }
      }
    }
    throw new Error("Could not shrink this logo under 12 KB — try a simpler image");
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}
