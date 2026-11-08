import { beforeEach, expect, it, vi } from "vitest";
const { db, create, update, list, getCode } = vi.hoisted(() => ({ db: new Map<string, unknown>(), create: vi.fn(), update: vi.fn(), list: vi.fn(), getCode: vi.fn() }));
vi.mock("idb-keyval", () => ({ createStore: vi.fn(), get: async (k: string) => db.get(k), set: vi.fn(async (k: string, v: unknown) => { db.set(k, v); }), del: async (k: string) => { db.delete(k); }, entries: async () => [...db], delMany: async (keys: string[]) => keys.forEach((k) => db.delete(k)) }));
vi.mock("@/lib/client/api", async (orig) => {
  const m = await orig<typeof import("@/lib/client/api")>();
  return { ...m, api: { codes: { create, update, list, all: list, get: getCode } } };
});
import { set } from "idb-keyval";
import { ApiClientError } from "@/lib/client/api";
import { flushQueue, library, optimisticView, queue, saveEdit, saveNew } from "@/lib/client/offline";
import { defaultStyle, type CreateInput } from "@/lib/schema";
const input = (): CreateInput => ({ name: "Offline", mode: "static", type: "text", payload: "hello", fields: { text: "hello" }, style: defaultStyle() });
beforeEach(() => { db.clear(); vi.clearAllMocks(); vi.stubGlobal("navigator", { onLine: false }); });
it("refuses to claim a queued save when IndexedDB fails", async () => {
  vi.mocked(set).mockRejectedValueOnce(new Error("Quota exceeded"));
  await expect(saveNew(input())).rejects.toThrow("Quota exceeded");
  expect(await queue.list()).toEqual([]);
});
it("edits a pending create in place rather than sending a PATCH for a missing server record", async () => {
  const { view } = await saveNew(input());
  await saveEdit(view, { name: "Edited before reconnect" });
  const ops = await queue.list();
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ kind: "create", input: { name: "Edited before reconnect" } });
  expect(update).not.toHaveBeenCalled();
});
it("replays a conflict copy with a stable identity after an ambiguous response; preserves other pending records", async () => {
  const base = { ...optimisticView({ ...input(), id: "originalid0001" }), rev: 2, hasPassword: true, mode: "dynamic" as const };
  const opId = "conflictop000001";
  await queue.put({ opId, kind: "update", at: new Date().toISOString(), id: base.id, baseRev: 2, base, patch: { name: "Changed offline" }, status: "pending" });
  const pending = optimisticView({ ...input(), id: "pendingid00001" });
  await library.upsert(pending);
  vi.stubGlobal("navigator", { onLine: true });
  update.mockRejectedValue(new ApiClientError("REV_MISMATCH", "Changed elsewhere", 409));
  create.mockRejectedValueOnce(new ApiClientError("OFFLINE", "Response lost"));
  create.mockImplementation(async (i) => ({ ...optimisticView(i), _pending: undefined, rev: 1 }));
  getCode.mockResolvedValue(base);
  list.mockResolvedValue({ items: [base] });
  expect((await flushQueue()).stopped).toBe(true);
  expect((await flushQueue()).synced).toBe(1);
  expect(create.mock.calls.map(([i]) => i.id)).toEqual([opId, opId]);
  expect(create.mock.calls[0]![0]).toMatchObject({ enabled: false });
  expect((await library.read()).items.some((v) => v.id === pending.id && v._pending === "create")).toBe(true);
  expect(await queue.list()).toEqual([]);
});
