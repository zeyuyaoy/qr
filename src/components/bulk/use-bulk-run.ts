"use client";
import { useCallback, useRef, useState } from "react";
import { errMsg, inBatches } from "@/components/library/common";
import { ApiClientError, api } from "@/lib/client/api";
import { resolveLogoUrl } from "@/lib/client/logo";
import { library } from "@/lib/client/offline";
import { renderBlob } from "@/lib/qr/render";
import type { CreateInput, ExportFormat, QrStyle, QrView } from "@/lib/schema";

export type Job = { key: string; data: string };
export type GenState = { phase: "idle" | "running" | "done" | "cancelled"; done: number; total: number; errors: Record<string, string> };
export type SaveStatus = { state: "saving" } | { state: "saved"; id: string } | { state: "failed"; error: string; code?: string };
export type SaveItem = { key: string; input: CreateInput };

const SAVE_CHUNK = 50;
const IDLE: GenState = { phase: "idle", done: 0, total: 0, errors: {} };

/** Rendering (3 at a time, cancellable) and saving (chunks of 50, per-row results) for the bulk page. */
export function useBulkRun() {
  const [gen, setGen] = useState<GenState>(IDLE);
  const [blobs, setBlobs] = useState<{ sig: string; map: ReadonlyMap<string, Blob> } | null>(null);
  const [saves, setSaves] = useState<Record<string, SaveStatus>>({});
  const [saving, setSaving] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });
  const stopGen = useRef(false);
  const stopSave = useRef(false);

  /** Resolves with what was rendered (partial when cancelled) so callers can continue straight into a ZIP. */
  const generate = useCallback(async (jobs: Job[], style: QrStyle, format: ExportFormat, sig: string): Promise<{ map: ReadonlyMap<string, Blob>; cancelled: boolean; failed: number }> => {
    stopGen.current = false;
    setGen({ phase: "running", done: 0, total: jobs.length, errors: {} });
    const map = new Map<string, Blob>();
    const errors: Record<string, string> = {};
    try {
      const logoUrl = await resolveLogoUrl(style.logo.assetId);
      await inBatches(
        jobs,
        3,
        async (job) => {
          try {
            map.set(job.key, await renderBlob({ data: job.data, style, logoUrl, format }));
          } catch (e) {
            errors[job.key] = errMsg(e, "Could not render");
          }
          setGen((g) => ({ ...g, done: g.done + 1 }));
        },
        () => stopGen.current,
      );
    } catch (e) {
      for (const j of jobs) errors[j.key] ??= errMsg(e, "Could not render");
    }
    const cancelled = stopGen.current;
    setBlobs({ sig, map });
    setGen((g) => ({ ...g, phase: cancelled ? "cancelled" : "done", errors }));
    return { map, cancelled, failed: Object.keys(errors).length };
  }, []);

  const save = useCallback(async (items: SaveItem[]) => {
    stopSave.current = false;
    setSaving({ running: true, done: 0, total: items.length });
    for (let i = 0; i < items.length && !stopSave.current; i += SAVE_CHUNK) {
      const chunk = items.slice(i, i + SAVE_CHUNK);
      setSaves((s) => ({ ...s, ...Object.fromEntries(chunk.map((c) => [c.key, { state: "saving" } as SaveStatus])) }));
      const next: Record<string, SaveStatus> = {};
      const created: QrView[] = [];
      try {
        const { results } = await api.codes.bulkCreate(chunk.map((c) => c.input));
        chunk.forEach((c, j) => {
          const r = results[j];
          if (r?.ok) {
            created.push(r.data);
            next[c.key] = { state: "saved", id: r.data.id };
          } else next[c.key] = { state: "failed", error: r ? r.error.message : "The server returned no result for this row", code: r?.error.code };
        });
      } catch (e) {
        // The request itself failed (offline / outage). Rows keep their ids, so a retry cannot create duplicates.
        for (const c of chunk) next[c.key] = { state: "failed", error: errMsg(e), code: e instanceof ApiClientError ? e.code : undefined };
      }
      setSaves((s) => ({ ...s, ...next }));
      if (created.length) {
        const { items: cached } = await library.read();
        const ids = new Set(created.map((c) => c.id));
        await library.write([...created, ...cached.filter((c) => !ids.has(c.id))]);
      }
      setSaving((p) => ({ ...p, done: Math.min(p.total, p.done + chunk.length) }));
    }
    setSaving((p) => ({ ...p, running: false }));
  }, []);

  return {
    gen,
    blobs,
    saves,
    saving,
    generate,
    save,
    cancelGenerate: () => void (stopGen.current = true),
    cancelSave: () => void (stopSave.current = true),
    resetSaves: useCallback(() => setSaves({}), []),
    resetOutputs: useCallback(() => {
      setGen(IDLE);
      setBlobs(null);
    }, []),
  };
}
