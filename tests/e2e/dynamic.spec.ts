import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CSRF, chooseDynamic, fillUrl, gotoCreate, saveCode } from "./helpers/app";

async function createDynamic(page: Page, dest: string, extra?: (p: Page) => Promise<void>) {
  await gotoCreate(page);
  await fillUrl(page, dest);
  await chooseDynamic(page);
  const slug = await page.getByRole("textbox", { name: "Short link" }).inputValue();
  if (extra) await extra(page);
  const { id } = await saveCode(page);
  return { id, slug };
}
const hit = (request: APIRequestContext, slug: string) => request.get(`/r/${slug}`, { maxRedirects: 0 });

test("dynamic QR encodes the short link and redirects without a login", async ({ page, playwright, baseURL }) => {
  const { slug } = await createDynamic(page, "https://example.com/a?x=1#frag");
  await expect(page.getByTestId("qr-preview")).toHaveAttribute("data-qr-data", `${baseURL}/r/${slug}`);
  const anon = await playwright.request.newContext({ baseURL });
  const res = await hit(anon, slug);
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toBe("https://example.com/a?x=1#frag");
  expect(res.headers()["cache-control"]).toContain("no-store");
  const missing = await hit(anon, "does-not-exist");
  expect(missing.status()).toBe(404);
});

test("editing the destination takes effect immediately; pause/resume works", async ({ page, playwright, baseURL }) => {
  const { id, slug } = await createDynamic(page, "https://example.com/one");
  const anon = await playwright.request.newContext({ baseURL });
  expect((await hit(anon, slug)).headers()["location"]).toBe("https://example.com/one");

  await page.goto(`/library/${id}`);
  await page.locator('input[name="url"]').fill("https://example.com/two");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect((await hit(anon, slug)).headers()["location"]).toBe("https://example.com/two");

  await page.getByRole("switch", { name: "Link active" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  const paused = await hit(anon, slug);
  expect(paused.status()).toBe(403);
  expect(await paused.text()).toContain("Link paused");

  await page.getByRole("switch", { name: "Link active" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect((await hit(anon, slug)).status()).toBe(307);
});

test("expired link shows the expired page and optional replacement redirect", async ({ page, playwright, baseURL }) => {
  const { id, slug } = await createDynamic(page, "https://example.com/promo");
  const anon = await playwright.request.newContext({ baseURL });
  await page.goto(`/library/${id}`);
  await page.getByLabel("Expiry").selectOption("at");
  await page.getByLabel(/^Expires at/).fill("2020-01-01T00:00");
  await page.getByLabel("Custom message").fill("Promo ended <b>sorry</b>");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  const res = await hit(anon, slug);
  expect(res.status()).toBe(410);
  const body = await res.text();
  expect(body).toContain("Promo ended &lt;b&gt;sorry&lt;/b&gt;"); // user text is escaped, never rendered as HTML
  expect(body).not.toContain("<b>sorry");

  await page.getByLabel(/^Replacement destination/).fill("https://example.com/next");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  const redirected = await hit(anon, slug);
  expect(redirected.status()).toBe(307);
  expect(redirected.headers()["location"]).toBe("https://example.com/next");
});

test("scan limit: exactly N accepted scans, then exhausted", async ({ page, playwright, baseURL }) => {
  const { slug } = await createDynamic(page, "https://example.com/limited", async (p) => {
    await p.getByLabel("Maximum scans").fill("2");
  });
  const anon = await playwright.request.newContext({ baseURL });
  expect((await hit(anon, slug)).status()).toBe(307);
  expect((await hit(anon, slug)).status()).toBe(307);
  const third = await hit(anon, slug);
  expect(third.status()).toBe(410);
  expect(await third.text()).toContain("Scan limit reached");
});

test("password gate: wrong password is rejected and not counted, right one redirects", async ({ page, playwright, baseURL }) => {
  const { slug } = await createDynamic(page, "https://example.com/secret", async (p) => {
    await p.getByPlaceholder("No password").fill("open-sesame");
    await p.getByLabel("Maximum scans").fill("1");
  });
  const anon = await playwright.request.newContext({ baseURL });
  const gate = await hit(anon, slug);
  expect(gate.status()).toBe(200);
  expect(await gate.text()).toContain("Password required");
  const bad = await anon.post(`/r/${slug}`, { form: { password: "nope" }, maxRedirects: 0 });
  expect(bad.status()).toBe(401);
  const good = await anon.post(`/r/${slug}`, { form: { password: "open-sesame" }, maxRedirects: 0 });
  expect(good.status()).toBe(303);
  expect(good.headers()["location"]).toBe("https://example.com/secret");
  // limit was 1 and only the accepted scan counted:
  const after = await anon.post(`/r/${slug}`, { form: { password: "open-sesame" }, maxRedirects: 0 });
  expect(after.status()).toBe(410);
});

test("dynamic codes reject dangerous destinations server-side", async ({ request }) => {
  const res = await request.post("/api/codes", {
    headers: CSRF,
    data: { name: "x", type: "url", mode: "dynamic", fields: {}, payload: "javascript:alert(1)", slug: "bad-dest-1", style: {} },
  });
  expect(res.status()).toBe(400);
});
