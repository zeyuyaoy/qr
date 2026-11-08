import { expect, test } from "@playwright/test";

test("theme cycles and reloads without hydration errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Theme: system. Switch to light" }).click();
  await expect(page.locator("html")).toHaveClass("light");
  await page.getByRole("button", { name: "Theme: light. Switch to dark" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.reload();
  await expect(page.getByRole("button", { name: "Theme: dark. Switch to system" })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [320, 768, 1024, 1440]) {
  test(`workspace fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const route of ["/", "/templates", "/settings"]) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      // Buttons must fit their own boxes too: clipped cards can hide overflow from the page.
      const clipped = await page.locator("main button:visible").evaluateAll((buttons) =>
        buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent),
      );
      expect(clipped).toEqual([]);
    }
    await page.goto("/templates");
    await page.getByRole("button", { name: "New template", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}
