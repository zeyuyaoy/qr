import { afterEach, expect, it, vi } from "vitest";
import { api, ApiClientError } from "@/lib/client/api";
afterEach(() => vi.unstubAllGlobals());
it("client API sends same-origin CSRF requests and unwraps the server envelope", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { saved: true } })));
  vi.stubGlobal("fetch", fetch);
  expect(await api.admin.init()).toEqual({ saved: true });
  expect(fetch).toHaveBeenCalledWith("/api/admin/init", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store", headers: { "x-qr-csrf": "1", "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "start-empty" }) }));
});
it("client API preserves server errors and distinguishes network failures", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: { code: "REV_MISMATCH", message: "Changed elsewhere" } }), { status: 409 })));
  await expect(api.status()).rejects.toMatchObject({ code: "REV_MISMATCH", status: 409, retryable: false });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await expect(api.status()).rejects.toBeInstanceOf(ApiClientError);
  await expect(api.status()).rejects.toMatchObject({ code: "OFFLINE", retryable: true });
});
it("loads every server page instead of silently limiting the library to 2000 codes", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { items: [{ id: "first" }], total: 2, unreadable: [] } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { items: [{ id: "second" }], total: 2, unreadable: [] } })));
  vi.stubGlobal("fetch", fetch);
  expect((await api.codes.all({ status: "all" })).items.map((v) => v.id)).toEqual(["first", "second"]);
  expect(fetch.mock.calls[1]![0]).toContain("offset=1");
});
