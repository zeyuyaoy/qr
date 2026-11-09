import {expect, test} from "@playwright/test";

test("theme cycles and reloads without hydration errors", async ({page}) => {
    const errors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({colorScheme: "dark"});
    await page.goto("/?content=https%3A%2F%2Fexample.com");
    const tint = page.locator('meta[name="theme-color"]');
    const toaster = page.locator("[data-sonner-toaster]");
    await expect(tint).toHaveAttribute("content", "#141a16");
    await expect(toaster).toHaveAttribute("data-sonner-theme", "dark");
    await page.getByRole("button", {name: "Theme: system. Switch to light"}).press("Enter");
    await expect(page.locator("html")).toHaveClass("light");
    await expect(tint).toHaveAttribute("content", "#d8dfcf");
    await expect(toaster).toHaveAttribute("data-sonner-theme", "light");
    await page.getByRole("button", {name: "Theme: light. Switch to dark"}).press("Enter");
    await expect(page.locator("html")).toHaveClass("dark");
    await expect(tint).toHaveAttribute("content", "#141a16");
    await page.reload();
    await expect(page.getByRole("button", {name: "Theme: dark. Switch to system"})).toBeVisible();
    await page.getByRole("button", {name: "Theme: dark. Switch to system"}).press("Enter");
    await page.emulateMedia({colorScheme: "light"});
    await expect(page.locator("html")).toHaveClass("light");
    await expect(tint).toHaveAttribute("content", "#d8dfcf");
    await expect(page.locator('script[src^="/_vercel/"]')).toHaveCount(0);
    expect(errors).toEqual([]);
});

for (const width of [320, 768, 1024, 1440]) {
    test(`workspace fits a ${width}px viewport`, async ({page}) => {
        await page.setViewportSize({width, height: 800});
        for (const route of ["/", "/templates", "/settings"]) {
            await page.goto(route);
            await expect(page.locator("h1")).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
            const clipped = await page.locator("main button:visible").evaluateAll((buttons) =>
                buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent),
            );
            expect(clipped).toEqual([]);
        }
        await page.goto("/templates");
        await page.getByRole("button", {name: "New template", exact: true}).first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const bounds = await dialog.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
        await dialog.getByRole("button", {name: "Close", exact: true}).click();
        await expect(dialog).toBeHidden();
    });
}
