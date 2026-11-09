import {readFileSync} from "node:fs";
import {expect, test} from "@playwright/test";
import {decodeQr} from "./helpers/decode";
import {CSRF, fillUrl, gotoCreate, qrPreview, saveCode} from "./helpers/app";

test("manifest and icons are valid and installable", async ({request}) => {
    const m = await (await request.get("/manifest.webmanifest")).json();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.share_target?.action).toBe("/");
    const purposes = m.icons.map((i: { purpose?: string }) => i.purpose);
    expect(purposes).toContain("maskable");
    for (const icon of m.icons as { src: string; sizes: string }[]) {
        const r = await request.get(icon.src);
        expect(r.status(), icon.src).toBe(200);
    }
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["service-worker-allowed"]).toBe("/");
});

test("works offline: shell loads, generation and export succeed, private API is never cached", async ({
                                                                                                          page,
                                                                                                          context
                                                                                                      }) => {
    await page.goto("/");
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(async () => {
        const name = (await caches.keys()).find((k) => k.startsWith("qr-pages-"));
        return name ? Boolean(await (await caches.open(name)).match("/")) : false;
    }), {timeout: 30_000}).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(qrPreview(page)).toBeVisible();
    await expect(page.getByText(/You're offline/)).toBeVisible();
    await fillUrl(page, "https://example.com/offline-test");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", {name: "Download"}).click()]);
    expect(await decodeQr(readFileSync((await download.path())!))).toBe("https://example.com/offline-test");

    const apiCached = await page.evaluate(async () => {
        for (const k of await caches.keys()) for (const req of await (await caches.open(k)).keys()) if (new URL(req.url).pathname.startsWith("/api/") || new URL(req.url).pathname.startsWith("/r/")) return req.url;
        return null;
    });
    expect(apiCached).toBeNull();
    await context.setOffline(false);
});

test("offline create is queued as pending, then synced when the connection returns", async ({
                                                                                                page,
                                                                                                context,
                                                                                                request
                                                                                            }) => {
    await gotoCreate(page);
    await page.locator('input[name="url"]').fill("https://example.com/queued");
    await page.locator("summary", {hasText: "Library details"}).click();
    await page.getByLabel("Name", {exact: true}).fill("Offline queued code");
    await context.setOffline(true);
    await page.getByRole("button", {name: "Save to library"}).click();
    await expect(page.getByText(/Pending|pending/).first()).toBeVisible();
    const mid = await request.get("/api/codes?q=Offline%20queued");
    expect((await mid.json()).data.total).toBe(0);
    await context.setOffline(false);
    await expect.poll(async () => (await (await request.get("/api/codes?q=Offline%20queued")).json()).data.total, {timeout: 30_000}).toBe(1);
});

test("offline dynamic link stays pending (not live) until Redis confirms it", async ({
                                                                                         page,
                                                                                         context,
                                                                                         request,
                                                                                         playwright,
                                                                                         baseURL
                                                                                     }) => {
    await gotoCreate(page);
    await page.locator('input[name="url"]').fill("https://example.com/pending-dyn");
    await page.locator('label:has-text("Dynamic")').click();
    await page.locator("summary", {hasText: "Link controls"}).click();
    const slug = await page.getByRole("textbox", {name: "Short link"}).inputValue();
    await context.setOffline(true);
    await page.getByRole("button", {name: "Save to library"}).click();
    await expect(page.getByText(/not live/i).first()).toBeVisible();
    const anon = await playwright.request.newContext({baseURL});
    expect((await anon.get(`/r/${slug}`, {maxRedirects: 0})).status()).toBe(404);
    await context.setOffline(false);
    await expect.poll(async () => (await anon.get(`/r/${slug}`, {maxRedirects: 0})).status(), {timeout: 30_000}).toBe(307);
    void request;
    void CSRF;
    void saveCode;
});

test("worker updates replace only QR caches and preserve offline shell installation", async ({page}) => {
    await page.goto("/");
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        await caches.open("unrelated-cache");
    });
    const version = `update-${Date.now()}`;
    await page.evaluate(async (v) => {
        await navigator.serviceWorker.register(`/sw.js?v=${v}`, {scope: "/"});
    }, version);
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL)).toContain(`v=${version}`);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("qr-pages-")).length)).toBe(1);
    const names = await page.evaluate(() => caches.keys());
    expect(names).toContain(`qr-pages-${version}`);
    expect(names).toContain("unrelated-cache");
});

test("sign-out clears private HTML, IndexedDB and cached folder names", async ({page}) => {
    await page.goto("/settings");
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        localStorage.setItem("qr.library.folders", "private-folder");
    });
    await page.locator("#account summary").click();
    await page.getByRole("button", {name: "Sign out", exact: true}).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("qr-pages-") || k.startsWith("qr-private")))).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem("qr.library.folders"))).toBeNull();
    const count = await page.evaluate(() => new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("qr-studio");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("kv")) {
                db.close();
                resolve(0);
                return;
            }
            const req = db.transaction("kv").objectStore("kv").count();
            req.onsuccess = () => {
                db.close();
                resolve(req.result);
            };
            req.onerror = () => {
                db.close();
                reject(req.error);
            };
        };
    }));
    expect(count).toBe(0);
});
