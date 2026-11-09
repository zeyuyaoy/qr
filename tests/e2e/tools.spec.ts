import {readFileSync, writeFileSync} from "node:fs";
import {unzipSync} from "fflate";
import {expect, test} from "@playwright/test";
import {decodeQr} from "./helpers/decode";
import {CSRF} from "./helpers/app";
import QRCode from "qrcode-generator";
import sharp from "sharp";

async function pngFor(text: string, path: string) {
    const qr = QRCode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const scale = 8, quiet = 4, size = (n + quiet * 2) * scale;
    const raw = Buffer.alloc(size * size, 255);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) raw[((r + quiet) * scale + y) * size + (c + quiet) * scale + x] = 0;
    await sharp(raw, {raw: {width: size, height: size, channels: 1}}).png().toFile(path);
}

test("scanner decodes an uploaded image and requires confirmation before opening a link", async ({page}) => {
    const path = "tests/e2e/.auth/scan-me.png";
    await pngFor("https://example.com/scanned?x=1#y", path);
    await page.goto("/scan");
    await page.locator('input[type="file"]').first().setInputFiles(path);
    await expect(page.getByText("https://example.com/scanned?x=1#y").first()).toBeVisible();
    const popup = page.waitForEvent("popup", {timeout: 1500}).catch(() => null);
    await page.getByRole("button", {name: /Open/}).first().click();
    expect(await popup).toBeNull();
    await expect(page.getByRole("dialog")).toContainText("example.com");
});

test("scanner reports when an image contains no QR code", async ({page}) => {
    const path = "tests/e2e/.auth/blank.png";
    await sharp({create: {width: 200, height: 200, channels: 3, background: "#fff"}}).png().toFile(path);
    await page.goto("/scan");
    await page.locator('input[type="file"]').first().setInputFiles(path);
    await expect(page.getByText(/No QR code|nothing|couldn't find|could not find/i).first()).toBeVisible();
});

test("scan → recreate prefills the generator", async ({page}) => {
    await page.goto("/?content=" + encodeURIComponent("WIFI:T:WPA;S:Cafe;P:hunter2hunter2;;"));
    await expect(page.getByLabel("Content type")).toHaveValue("wifi");
    await expect(page.locator('input[name="ssid"]')).toHaveValue("Cafe");
});

test("web share target parameters prefill the generator", async ({page}) => {
    await page.goto("/?url=" + encodeURIComponent("https://example.com/shared"));
    await expect(page.locator('input[name="url"]')).toHaveValue("https://example.com/shared");
});

test("bulk: paste URLs, per-row validation, ZIP of decodable codes, save to library", async ({page, request}) => {
    await page.goto("/bulk");
    const urls = ["https://example.com/one", "https://example.com/two", "not a url", "https://example.com/three"];
    await page.getByRole("textbox").first().fill(urls.join("\n"));
    await expect(page.getByText(/3 valid|3 rows valid|3 of 4/i).first()).toBeVisible();
    await expect(page.getByText(/not a url/).first()).toBeVisible();
    const [zip] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", {name: /ZIP/i}).click()]);
    const files = unzipSync(new Uint8Array(readFileSync((await zip.path())!)));
    const names = Object.keys(files);
    expect(names.length).toBe(3);
    const decoded = [];
    for (const n of names) decoded.push(await decodeQr(Buffer.from(files[n]!)));
    expect(decoded.sort()).toEqual(["https://example.com/one", "https://example.com/three", "https://example.com/two"]);

    await page.getByRole("button", {name: /Save to library|Save all/i}).click();
    await expect.poll(async () => (await (await request.get("/api/codes?q=example.com%2Fone")).json()).data.total, {timeout: 20_000}).toBeGreaterThan(0);
    void writeFileSync;
    void CSRF;
});

test("templates: save a style, apply it to an existing code", async ({page, request}) => {
    const c = await request.post("/api/codes", {
        headers: CSRF,
        data: {
            name: "Tpl target",
            type: "url",
            mode: "static",
            fields: {url: "https://example.com/t"},
            payload: "https://example.com/t",
            style: {}
        }
    });
    const id = (await c.json()).data.id;
    const t = await request.post("/api/templates", {
        headers: CSRF,
        data: {name: "E2E blue", style: {fg: "#0b3b8c", bg: "#ffffff", dots: "rounded"}}
    });
    expect(t.status()).toBe(201);
    const tid = (await t.json()).data.id;
    const res = await request.post("/api/codes/batch", {
        headers: CSRF,
        data: {ids: [id], action: "apply-template", value: tid}
    });
    expect((await res.json()).data.succeeded).toBe(1);
    expect((await (await request.get(`/api/codes/${id}`)).json()).data.style.fg).toBe("#0b3b8c");
    await page.goto("/templates");
    await expect(page.getByText("E2E blue").first()).toBeVisible();
    await page.getByRole("button", {name: "Apply E2E blue to codes"}).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("searchbox", {name: "Search codes"}).fill("Tpl target");
    await dialog.getByRole("button", {name: /Tpl target/}).click();
    await dialog.getByRole("button", {name: "Apply to 1 code", exact: true}).click();
    await expect(dialog.getByRole("button", {name: "Done"})).toBeVisible();
    await dialog.getByRole("button", {name: "Done"}).click();
    await expect(dialog).toBeHidden();
});

test("analytics and settings pages render", async ({page}) => {
    await page.goto("/analytics");
    await expect(page.getByRole("heading", {name: "Analytics"})).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("heading", {name: "Settings"})).toBeVisible();
    await expect(page.locator("#backup")).toBeAttached();
    await page.getByRole("link", {name: "Set up backups"}).click();
    await expect(page).toHaveURL(/\/settings#backup$/);
    await expect(page.locator("#backup")).toHaveAttribute("open", "");
    await page.reload();
    await expect(page.locator("#backup")).toHaveAttribute("open", "");
    await expect(page.getByRole("link", {name: "Download encrypted export", exact: true})).toBeVisible();
});

test("backup: encrypted export, restore dry-run, and corrupted snapshot rejection", async ({request}) => {
    const dl = await request.get("/api/backup/download");
    expect(dl.status()).toBe(200);
    const text = await dl.text();
    expect(text).not.toContain("example.com");
    const dry = await request.post("/api/backup/restore", {
        headers: CSRF,
        data: {source: {text}, dryRun: true, mode: "merge", prefer: "newer"}
    });
    expect(dry.status()).toBe(200);
    const rep = (await dry.json()).data.report;
    expect(rep.dryRun).toBe(true);
    const env = JSON.parse(text);
    env.data = env.data.slice(0, -8) + "AAAAAAAA";
    const bad = await request.post("/api/backup/restore", {
        headers: CSRF,
        data: {source: {text: JSON.stringify(env)}, dryRun: true}
    });
    expect(bad.status()).toBe(400);
    const manual = await request.post("/api/backup", {headers: CSRF});
    expect((await manual.json()).data.outcome).toBe("failed");
});

test("bulk CSV maps its header and downloads a ZIP without opening advanced settings", async ({page}) => {
    await page.goto("/bulk");
    await page.getByRole("tab", {name: "CSV / spreadsheet"}).click();
    await page.getByRole("textbox", {name: "Paste CSV or spreadsheet cells"}).fill(
        "name,url\nMenu,https://example.com/csv-menu\nAbout,https://example.com/csv-about",
    );
    await expect(page.getByText("2 codes are ready.")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", {name: /Download all as ZIP/}).click();
    const files = unzipSync(new Uint8Array(readFileSync((await (await download).path())!)));
    expect(Object.keys(files)).toHaveLength(2);
    const payloads = await Promise.all(Object.values(files).map((file) => decodeQr(Buffer.from(file))));
    expect(payloads.sort()).toEqual(["https://example.com/csv-about", "https://example.com/csv-menu"]);
});
