import { expect, test } from "@playwright/test";

test("mobile layout: bottom navigation, no sidebar, no horizontal scroll", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary" }).last();
  await expect(nav).toBeVisible();
  await expect(page.locator('aside[aria-label="Primary"]')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await nav.getByRole("button", { name: "More" }).click();
  for (const item of ["Templates", "Bulk", "Settings"]) await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole("heading", { name: "Defaults", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("navigation", { name: "Primary" }).last().getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library/, { timeout: 20_000 });
});

test("touch targets on the generator are at least 40px", async ({ page }) => {
  await page.goto("/");
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main button, main [role=radio], main a, main select, main input:not([type=radio]):not([type=range]):not([type=color])")]
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ t: e.textContent?.trim().slice(0, 20) || e.getAttribute("aria-label") || e.tagName, h: e.getBoundingClientRect().height }))
      .filter((x) => x.h > 1 && x.h < 36),
  );
  expect(small, JSON.stringify(small)).toEqual([]);
});

test("every main screen stays within phone and tablet viewports after loading", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/library", "/scan", "/analytics", "/templates", "/bulk", "/settings"]) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px ${path}`).toBeLessThanOrEqual(1);
    }
  }
  expect(errors).toEqual([]);
});

test("More menu supports keyboard navigation and Escape", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "More", exact: true });
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(button).toBeFocused();
});
