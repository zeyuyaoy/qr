import { expect, type Page } from "@playwright/test";

export const CSRF = { "x-qr-csrf": "1", "content-type": "application/json" };

export async function gotoCreate(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("qr-preview")).toBeVisible();
  await expect(page.locator("svg", { hasText: "" }).first()).toBeAttached();
}

export async function fillUrl(page: Page, url: string) {
  await page.locator('input[name="url"]').fill(url);
  await expect(page.getByTestId("qr-preview")).toHaveAttribute("data-qr-data", /./);
}

export async function chooseDynamic(page: Page) {
  await page.locator('label:has-text("Dynamic")').click();
  await page.locator("summary", { hasText: "Link controls" }).click();
}

export async function saveCode(page: Page): Promise<{ id: string }> {
  await page.getByRole("button", { name: /Save to library|Save changes/ }).click();
  const link = page.getByRole("link", { name: "Open in library" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  return { id: href.split("/").pop()! };
}

export async function waitPreviewSvg(page: Page) {
  await expect(page.getByTestId("qr-preview").locator("svg")).toBeAttached({ timeout: 15_000 });
}
