import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { decodeQr } from "./helpers/decode";
import { fillUrl, gotoCreate, waitPreviewSvg } from "./helpers/app";

const URL_WITH_PARTS = "https://example.com/menu?table=4&lang=en#top";

test("generates a static QR live, in the browser, preserving query and fragment", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));
  await gotoCreate(page);
  await page.waitForLoadState("networkidle");
  const before = requests.length;
  await fillUrl(page, URL_WITH_PARTS);
  await expect(page.getByTestId("qr-preview")).toHaveAttribute("data-qr-data", URL_WITH_PARTS);
  await waitPreviewSvg(page);
  // Typing must not trigger any network request (generation is client-side).
  expect(requests.slice(before).filter((p) => p.startsWith("/api/"))).toEqual([]);
});

for (const format of ["png", "svg", "webp", "jpeg"] as const) {
  test(`export ${format.toUpperCase()} decodes to the exact payload (independent decoder)`, async ({ page }) => {
    await gotoCreate(page);
    await fillUrl(page, URL_WITH_PARTS);
    await page.getByLabel("Format").selectOption(format);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
    const buf = readFileSync((await download.path())!);
    expect(await decodeQr(buf)).toBe(URL_WITH_PARTS);
  });
}

test("customised design (preset, gradient, rounded shapes) still scans", async ({ page }) => {
  await gotoCreate(page);
  await fillUrl(page, URL_WITH_PARTS);
  await page.locator("summary", { hasText: "Customize" }).click();
  await page.getByRole("button", { name: "Ocean" }).click();
  await expect(page.getByText("No readability problems detected.")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  expect(await decodeQr(readFileSync((await download.path())!))).toBe(URL_WITH_PARTS);
});

test("low contrast design is flagged", async ({ page }) => {
  await gotoCreate(page);
  await page.locator("summary", { hasText: "Customize" }).click();
  await page.getByLabel("Foreground hex value").fill("#cccccc");
  await expect(page.getByLabel("Readability checks").getByText(/Low contrast/)).toBeVisible();
});

test("Wi-Fi payload follows the standard format", async ({ page }) => {
  await gotoCreate(page);
  await page.getByRole("radio", { name: "Wi-Fi" }).click();
  await page.locator('input[name="ssid"]').fill("Home;Net");
  await page.locator('input[name="password"]').fill("correct-horse-battery");
  await expect(page.getByTestId("qr-preview")).toHaveAttribute("data-qr-data", "WIFI:T:WPA;S:Home\\;Net;P:correct-horse-battery;;");
});

test("invalid URL shows an accessible error and blocks save", async ({ page }) => {
  await gotoCreate(page);
  await fillUrl(page, "javascript:alert(1)");
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
});

test("late settings never overwrite content or mode already entered by the user", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/settings", async (route) => { await gate; await route.continue(); });
  await gotoCreate(page);
  await fillUrl(page, "https://example.com/typed-before-settings");
  await page.locator('label:has-text("Dynamic")').click();
  release();
  await page.waitForResponse("**/api/settings");
  await expect(page.locator('input[name="url"]')).toHaveValue("https://example.com/typed-before-settings");
  await expect(page.locator('input[name="qr-mode"]').last()).toBeChecked();
  await expect(page.locator("summary", { hasText: "Link controls" })).toBeVisible();
});

for (const type of ["text", "email", "phone", "sms", "wifi", "vcard", "event", "geo", "whatsapp", "social", "doi"] as const) {
  test(`${type} content can be recreated, exported and independently decoded`, async ({ page }) => {
    const { TYPES, encodePayload } = await import("../../src/lib/qr/payload");
    const example = encodePayload(type, TYPES[type].example);
    if (!example.ok) throw new Error(`Invalid ${type} fixture`);
    await page.goto(`/?content=${encodeURIComponent(example.payload)}`);
    await expect(page.getByText("Content loaded from scan")).toBeVisible();
    const data = await page.getByTestId("qr-preview").getAttribute("data-qr-data");
    expect(data).toBeTruthy();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
    expect(await decodeQr(readFileSync((await download.path())!))).toBe(data);
  });
}

test("uploaded logo stays readable in the exported image", async ({ page }) => {
  const sharp = (await import("sharp")).default;
  const logo = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#3849ba" } }).png().toBuffer();
  await gotoCreate(page);
  await fillUrl(page, "https://example.com/logo");
  await page.locator("summary", { hasText: "Customize" }).click();
  await page.locator("summary", { hasText: "Logo" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
  await expect(page.getByAltText("Current logo")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  expect(await decodeQr(readFileSync((await download.path())!))).toBe("https://example.com/logo");
});
