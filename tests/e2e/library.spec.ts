import {readFileSync, writeFileSync} from "node:fs";
import {type APIRequestContext, expect, test} from "@playwright/test";
import {CSRF} from "./helpers/app";
import {e2eRedisUrl} from "./helpers/redis";

const mk = async (request: APIRequestContext, name: string, url: string, extra: object = {}) => {
    const res = await request.post("/api/codes", {
        headers: CSRF,
        data: {name, type: "url", mode: "static", fields: {url}, payload: url, style: {}, ...extra}
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).data as { id: string; rev: number };
};

test("library displays empty folders and filters codes by folder", async ({page, request}) => {
    const createFolder = async (name: string) => {
        const res = await request.post("/api/folders", {headers: CSRF, data: {name}});
        expect(res.status(), await res.text()).toBe(201);
        return (await res.json()).data.id;
    };
    const folder = await createFolder("Menus");
    await createFolder("Empty folder");

    await page.goto("/library");
    const folders = page.getByRole("region", {name: "Folders"});
    await expect(folders.getByRole("button", {name: "Empty folder"})).toBeVisible();

    await mk(request, "Menu QR", "https://example.com/menu", {folder});
    await mk(request, "Unfiled QR", "https://example.com/unfiled");
    await page.reload();
    await expect(page.getByRole("link", {name: "Unfiled QR"})).toBeVisible();
    const menus = folders.getByRole("button", {name: "Menus"});
    await menus.click();
    await expect(menus).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", {name: "Menu QR"})).toBeVisible();
    await expect(page.getByRole("link", {name: "Unfiled QR"})).toHaveCount(0);
    await menus.click();
    await expect(page.getByRole("link", {name: "Unfiled QR"})).toBeVisible();
});

test("library: create, search, edit, duplicate, favorite, archive, restore, trash, purge", async ({page, request}) => {
    const tag = `t${Date.now() % 100000}`;
    const a = await mk(request, `Alpha ${tag}`, "https://example.com/alpha", {tags: [tag]});
    await mk(request, `Beta ${tag}`, "https://example.com/beta", {tags: [tag]});

    await page.goto("/library");
    await page.getByLabel(/Search codes/).fill(`Alpha ${tag}`);
    await expect(page.getByText(`Alpha ${tag}`).first()).toBeVisible();
    await expect(page.getByText(`Beta ${tag}`)).toHaveCount(0);

    await page.getByRole("button", {name: `Actions for Alpha ${tag}`}).click();
    await page.getByRole("menuitem", {name: "Duplicate"}).click();
    await expect(page.getByText(`Alpha ${tag} (copy)`).first()).toBeVisible();

    await page.goto(`/library/${a.id}`);
    await page.getByText("Library details", {exact: true}).click();
    await page.getByLabel("Name", {exact: true}).fill(`Alpha renamed ${tag}`);
    await page.getByRole("button", {name: "Save changes"}).click();
    await expect(page.getByRole("button", {name: "Saved"})).toBeVisible();
    const got = await (await request.get(`/api/codes/${a.id}`)).json();
    expect(got.data.name).toBe(`Alpha renamed ${tag}`);
    expect(got.data.rev).toBe(2);

    const batch = (action: string) => request.post("/api/codes/batch", {headers: CSRF, data: {ids: [a.id], action}});
    expect((await (await batch("archive")).json()).data.succeeded).toBe(1);
    expect((await (await request.get(`/api/codes?status=archived&q=${tag}`)).json()).data.total).toBe(1);
    await batch("restore");
    await batch("trash");
    expect((await (await request.get(`/api/codes?status=trashed&q=${tag}`)).json()).data.total).toBe(1);
    const purge = await request.delete(`/api/codes/${a.id}?permanent=1`, {headers: CSRF});
    expect(purge.status()).toBe(200);
    expect((await request.get(`/api/codes/${a.id}`)).status()).toBe(404);
});

test("optimistic concurrency: stale edit is rejected with REV_MISMATCH", async ({request}) => {
    const c = await mk(request, "Conflict code", "https://example.com/c");
    const ok = await request.patch(`/api/codes/${c.id}`, {headers: CSRF, data: {name: "first", ifRev: 1}});
    expect(ok.status()).toBe(200);
    const stale = await request.patch(`/api/codes/${c.id}`, {headers: CSRF, data: {name: "second", ifRev: 1}});
    expect(stale.status()).toBe(409);
    expect((await stale.json()).error.code).toBe("REV_MISMATCH");
});

test("slug uniqueness is enforced across codes", async ({request}) => {
    const body = {
        type: "url",
        mode: "dynamic",
        fields: {url: "https://example.com/s"},
        payload: "https://example.com/s",
        style: {},
        slug: "uniq-slug-e2e"
    };
    expect((await request.post("/api/codes", {headers: CSRF, data: {...body, name: "s1"}})).status()).toBe(201);
    const dup = await request.post("/api/codes", {headers: CSRF, data: {...body, name: "s2"}});
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.code).toBe("SLUG_TAKEN");
});

test("Wi-Fi codes are sealed at rest: the password never appears in Redis", async ({page, request}) => {
    await page.goto("/");
    await page.getByLabel("Content type").selectOption("wifi");
    await page.locator('input[name="ssid"]').fill("SealedNet");
    await page.locator('input[name="password"]').fill("super-secret-pass-123");
    await page.getByRole("button", {name: "Save to library"}).click();
    const link = page.getByRole("link", {name: "Open in library"});
    await expect(link).toBeVisible();
    const id = (await link.getAttribute("href"))!.split("/").pop()!;
    const {createClient} = await import("redis");
    const r = createClient({url: e2eRedisUrl()});
    await r.connect();
    const raw = (await r.get(`qr:v1:code:${id}`))!;
    await r.quit();
    expect(raw).not.toContain("super-secret-pass-123");
    const view = (await (await request.get(`/api/codes/${id}`)).json()).data;
    expect(view.payload).toContain("super-secret-pass-123");
});

test("library JSON export and import round-trip (dry run, then apply as copies)", async ({page, request}) => {
    const name = `Export me ${Date.now() % 100000}`;
    await mk(request, name, "https://example.com/export");
    const exp = await request.get("/api/library/export?format=json");
    expect(exp.headers()["content-disposition"]).toContain(".json");
    const data = await exp.json();
    expect(data.format).toBe("qr-studio-library");
    expect(JSON.stringify(data)).not.toContain("scrypt$");
    const csv = await request.get("/api/library/export?format=csv");
    expect(await csv.text()).toContain(name);

    const dry = await request.post("/api/library/import", {
        headers: CSRF,
        data: {data, dryRun: true, policy: "duplicate"}
    });
    expect((await dry.json()).data.created).toBeGreaterThan(0);
    const applied = await request.post("/api/library/import", {
        headers: CSRF,
        data: {data, dryRun: false, policy: "duplicate"}
    });
    expect((await applied.json()).data.created).toBeGreaterThan(0);
    expect((await (await request.get(`/api/codes?q=${encodeURIComponent(name + " (imported)")}`)).json()).data.total).toBeGreaterThan(0);

    const file = "tests/e2e/.auth/lib.json";
    writeFileSync(file, JSON.stringify(data));
    await page.goto("/library");
    await page.getByRole("button", {name: "Manage"}).click();
    await page.getByRole("menuitem", {name: /Import/}).click();
    await page.locator('input[type="file"]').last().setInputFiles(file);
    await expect(page.getByText(/Dry run: nothing has been changed yet/).first()).toBeVisible();
    void readFileSync;
});

test("analytics: scans are counted and exportable, reset clears them", async ({request, playwright, baseURL}) => {
    const c = await request.post("/api/codes", {
        headers: CSRF,
        data: {
            name: "Counted",
            type: "url",
            mode: "dynamic",
            fields: {url: "https://example.com/n"},
            payload: "https://example.com/n",
            style: {},
            slug: "counted-e2e"
        }
    });
    const id = (await c.json()).data.id;
    const anon = await playwright.request.newContext({baseURL});
    for (let i = 0; i < 3; i++) await anon.get("/r/counted-e2e", {
        maxRedirects: 0,
        headers: {"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"}
    });
    const rep = (await (await request.get(`/api/analytics?id=${id}`)).json()).data;
    expect(rep.totals.scans).toBe(3);
    const csv = await request.get("/api/analytics?format=csv");
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const g = (await (await request.get("/api/analytics")).json()).data;
    expect(g.devices.mobile).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(g)).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    await request.post("/api/analytics/reset", {headers: CSRF, data: {id, confirm: "reset"}});
    expect((await (await request.get(`/api/analytics?id=${id}`)).json()).data.totals.scans).toBe(0);
});
