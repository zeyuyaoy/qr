"use client";
import { api, type BatchAction } from "@/lib/client/api";
import { resolveLogoUrl } from "@/lib/client/logo";
import type { CachedView } from "@/lib/client/offline";
import { downloadBlob, makeFilename, printHtml } from "@/lib/qr/export";
import { clientAppUrl, qrData, shortUrl } from "@/lib/qr/payload";
import { blobToDataUrl, renderBlob } from "@/lib/qr/render";
import type { ExportFormat, QrStyle } from "@/lib/schema";
import { errMsg, inBatches } from "./common";

export type BatchResult = { id: string; ok: boolean; error?: string };

export const BATCH_VERB: Record<BatchAction, string> = {
  archive: "Archived",
  restore: "Restored",
  trash: "Moved to trash",
  purge: "Deleted forever",
  favorite: "Added to favorites",
  unfavorite: "Removed from favorites",
  pin: "Pinned",
  unpin: "Unpinned",
  enable: "Enabled",
  disable: "Paused",
  "tag-add": "Tag added to",
  "tag-remove": "Tag removed from",
  "move-folder": "Moved",
  "apply-template": "Template applied to",
};

/** Run a batch action in chunks of 200 (the API maximum). A failed chunk reports every id in it as failed. */
export async function runBatch(ids: string[], action: BatchAction, value?: string | null): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    try {
      out.push(...(await api.codes.batch(chunk, action, value)).results);
    } catch (e) {
      out.push(...chunk.map((id) => ({ id, ok: false, error: errMsg(e) })));
    }
  }
  return out;
}

/** Mirror of the server's batch patch, so the UI and the offline cache update without a full reload. */
export function applyLocal(item: CachedView, action: BatchAction, value?: string | null, templateStyle?: QrStyle): CachedView {
  switch (action) {
    case "archive":
      return { ...item, status: "archived" };
    case "restore":
      return { ...item, status: "active" };
    case "trash":
      return { ...item, status: "trashed", pinned: false };
    case "favorite":
      return { ...item, favorite: true };
    case "unfavorite":
      return { ...item, favorite: false };
    case "pin":
      return { ...item, pinned: true };
    case "unpin":
      return { ...item, pinned: false };
    case "enable":
      return { ...item, enabled: true, linkState: item.linkState === "paused" ? "ok" : item.linkState };
    case "disable":
      return { ...item, enabled: false, linkState: item.linkState === "ok" ? "paused" : item.linkState };
    case "tag-add":
      return value ? { ...item, tags: [...new Set([...item.tags, value])] } : item;
    case "tag-remove":
      return { ...item, tags: item.tags.filter((t) => t !== value) };
    case "move-folder":
      return { ...item, folder: value || null };
    case "apply-template":
      return templateStyle ? { ...item, style: templateStyle } : item;
    case "purge":
      return item;
  }
}

export const itemData = (item: Pick<CachedView, "mode" | "payload" | "slug">) => qrData(item, clientAppUrl());
export const itemShortLink = (item: Pick<CachedView, "slug">) => (item.slug ? shortUrl(clientAppUrl(), item.slug) : null);

export async function downloadItem(item: CachedView, format: ExportFormat, filenameTemplate: string) {
  const logoUrl = await resolveLogoUrl(item.style.logo.assetId);
  const blob = await renderBlob({ data: itemData(item), style: item.style, logoUrl, format });
  downloadBlob(blob, makeFilename(filenameTemplate, { name: item.name, type: item.type, slug: item.slug }, format));
}

/** Render codes to PNG data URLs (3 at a time) and hand them to the print dialog. */
export async function printItems(items: CachedView[], onProgress?: (done: number, total: number) => void) {
  const urls = new Array<string>(items.length);
  let done = 0;
  await inBatches(items, 3, async (item, i) => {
    const logoUrl = await resolveLogoUrl(item.style.logo.assetId);
    const blob = await renderBlob({ data: itemData(item), style: item.style, logoUrl, format: "png", size: 480 });
    urls[i] = await blobToDataUrl(blob);
    onProgress?.(++done, items.length);
  });
  printHtml(
    "QR codes",
    items.map((it, i) => ({ name: it.name, dataUrl: urls[i] ?? "" })),
  );
}
