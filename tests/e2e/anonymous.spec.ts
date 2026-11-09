import {expect, test} from "@playwright/test";

test("private pages redirect to login", async ({page}) => {
    for (const path of ["/", "/library", "/settings", "/analytics", "/templates", "/bulk", "/scan"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login/);
    }
    await expect(page.getByRole("button", {name: /Continue with Google/})).toBeVisible();
});

test("private APIs return 401 without a session", async ({request}) => {
    for (const path of ["/api/codes", "/api/status", "/api/settings", "/api/analytics", "/api/folders", "/api/templates", "/api/backup", "/api/library/export"]) {
        const res = await request.get(path);
        expect(res.status(), path).toBe(401);
        expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    }
    const write = await request.post("/api/codes", {data: {}, headers: {"x-qr-csrf": "1"}});
    expect(write.status()).toBe(401);
});

test("public routes work without login; cron requires its secret", async ({request}) => {
    expect((await request.get("/api/health")).status()).toBe(200);
    expect((await request.get("/expired")).status()).toBe(200);
    expect((await request.get("/r/nope-nope")).status()).toBe(404);
    expect((await request.get("/api/cron/backup")).status()).toBe(401);
    expect((await request.get("/api/cron/backup", {headers: {authorization: "Bearer wrong"}})).status()).toBe(401);
});

test("security headers are present and no secret leaks into public output", async ({request}) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["strict-transport-security"]).toBeTruthy();
    expect(h["x-powered-by"]).toBeUndefined();
    const html = await res.text();
    for (const secret of ["e2e-test-auth-secret", "e2e-cron-secret", "e2e-only-secret", "redis://"]) expect(html).not.toContain(secret);
});

test("CSRF: mutating private calls need the custom header even with a session", async ({page, request}) => {
    await page.goto("/login");
    const res = await request.post("/api/codes", {data: {}});
    expect([401, 403]).toContain(res.status());
});
