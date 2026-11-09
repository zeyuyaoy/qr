import {mkdirSync} from "node:fs";
import {chromium, type FullConfig} from "@playwright/test";
import {createClient} from "redis";
import {e2eRedisUrl} from "./helpers/redis";

export default async function globalSetup(config: FullConfig) {
    const r = createClient({url: e2eRedisUrl()});
    await r.connect();
    let cursor = "0";
    do {
        const res = await r.scan(cursor, {MATCH: "qr:v1:*", COUNT: 500});
        cursor = res.cursor;
        if (res.keys.length) await r.unlink(res.keys);
    } while (cursor !== "0");
    await r.set("qr:v1:meta:schema", JSON.stringify({
        schemaVersion: 1,
        initializedAt: new Date().toISOString(),
        instanceId: "e2e"
    }));
    await r.quit();

    mkdirSync("tests/e2e/.auth", {recursive: true});
    const base = config.projects[0]!.use.baseURL!;
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const csrf = await (await page.request.get(`${base}/api/auth/csrf`)).json();
    const res = await page.request.post(`${base}/api/auth/callback/test`, {
        form: {csrfToken: csrf.csrfToken, email: "owner@example.test", secret: "e2e-test-auth-secret", json: "true"},
    });
    if (!res.ok()) throw new Error(`test sign-in failed (${res.status()})`);
    await page.context().storageState({path: "tests/e2e/.auth/owner.json"});
    await browser.close();
}
