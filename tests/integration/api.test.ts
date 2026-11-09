import {T} from "./helpers/boot";
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {installFakeGithub} from "./helpers/github-fake";
import {DEST, dynamicUrl, pngDataUrl, staticText, wifi} from "./helpers/fixtures";
import {seedLibrary} from "./helpers/seed";
import {auth} from "@/auth";
import {ownerRoute, requireOwner} from "@/lib/guard";
import {closeRedis} from "@/lib/redis/client";
import {createCode, getCode, initMeta, scanCount} from "@/lib/redis/repo";
import {defaultStyle} from "@/lib/schema";
import * as codes from "@/app/api/codes/route";
import * as codeId from "@/app/api/codes/[id]/route";
import * as codeDup from "@/app/api/codes/[id]/duplicate/route";
import * as codeAnalytics from "@/app/api/codes/[id]/analytics/route";
import * as batch from "@/app/api/codes/batch/route";
import * as bulk from "@/app/api/codes/bulk/route";
import * as settings from "@/app/api/settings/route";
import * as folders from "@/app/api/folders/route";
import * as folderId from "@/app/api/folders/[id]/route";
import * as templates from "@/app/api/templates/route";
import * as templateId from "@/app/api/templates/[id]/route";
import * as tags from "@/app/api/tags/route";
import * as analytics from "@/app/api/analytics/route";
import * as analyticsReset from "@/app/api/analytics/reset/route";
import * as libExport from "@/app/api/library/export/route";
import * as libImport from "@/app/api/library/import/route";
import * as backup from "@/app/api/backup/route";
import * as backupDownload from "@/app/api/backup/download/route";
import * as backupRestore from "@/app/api/backup/restore/route";
import * as health from "@/app/api/health/route";
import * as status from "@/app/api/status/route";
import * as cron from "@/app/api/cron/backup/route";
import * as assets from "@/app/api/assets/route";
import * as assetId from "@/app/api/assets/[id]/route";
import * as adminInit from "@/app/api/admin/init/route";
import * as adminRepair from "@/app/api/admin/repair/route";

vi.mock("@/auth", () => ({auth: vi.fn()}));

type Session = { user: { email: string; isOwner: boolean } } | null;
const session = (s: Session) => vi.mocked(auth).mockResolvedValue(s as never);
const OWNER: Session = {user: {email: "owner@qr.test", isOwner: true}};

beforeEach(async () => {
    vi.unstubAllEnvs();
    await T.reset();
    await initMeta();
    session(OWNER);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
    await T.cleanup();
    await closeRedis();
    await T.close();
});

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
type Init = {
    body?: unknown;
    raw?: string;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    csrf?: boolean;
    origin?: string | null
};

async function call(handler: unknown, method: string, path: string, o: Init = {}) {
    const headers: Record<string, string> = {...(method !== "GET" && o.csrf !== false ? {"x-qr-csrf": "1"} : {}), ...(o.origin !== null && method !== "GET" ? {origin: o.origin ?? "https://qr.test"} : {}), ...o.headers};
    const hasBody = o.body !== undefined || o.raw !== undefined;
    if (hasBody) headers["content-type"] = "application/json";
    const req = new Request(`https://qr.test${path}`, {
        method,
        headers,
        body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined)
    });
    const res = await (handler as Handler)(req, {params: Promise.resolve((o.params ?? {}) as never)});
    const raw = await res.text();
    let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
        json = JSON.parse(raw);
    } catch {
    }
    return {status: res.status, json, raw, headers: res.headers};
}

const ok = (r: { status: number; json: any }, status = 200) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.json, JSON.stringify(r.json)).toMatchObject({ok: true});
    expect(r.status).toBe(status);
    return r.json.data;
};
const err = (r: { status: number; json: any }, status: number, code: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.status, JSON.stringify(r.json)).toBe(status);
    expect(r.json).toMatchObject({ok: false, error: {code, message: expect.any(String)}});
    expect(Object.keys(r.json).sort()).toEqual(["error", "ok"]);
    return r.json.error;
};

const newCode = async (o = {}) => ok(await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl(o)}), 201);

describe("guard: requireOwner / ownerRoute", () => {
    it("no session -> 401 UNAUTHENTICATED", async () => {
        session(null);
        err(await call(codes.GET, "GET", "/api/codes"), 401, "UNAUTHENTICATED");
        session({user: {}} as never);
        err(await call(codes.GET, "GET", "/api/codes"), 401, "UNAUTHENTICATED");
    });
    it("signed in but not an owner -> 403 FORBIDDEN", async () => {
        session({user: {email: "stranger@example.com", isOwner: false}});
        err(await call(codes.GET, "GET", "/api/codes"), 403, "FORBIDDEN");
        session({user: {email: "stranger@example.com", isOwner: true}});
        err(await call(codes.GET, "GET", "/api/codes"), 403, "FORBIDDEN");
        session({user: {email: "owner@qr.test", isOwner: false}});
        err(await call(codes.GET, "GET", "/api/codes"), 403, "FORBIDDEN");
    });
    it("the owner passes; emails are matched case-insensitively against OWNER_EMAILS", async () => {
        ok(await call(codes.GET, "GET", "/api/codes"));
        session({user: {email: "SECOND@QR.TEST", isOwner: true}});
        ok(await call(codes.GET, "GET", "/api/codes"));
    });
    it("state-changing requests need the CSRF header", async () => {
        err(await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl(), csrf: false}), 403, "FORBIDDEN");
        err(await call(codes.POST, "POST", "/api/codes", {
            body: dynamicUrl(),
            headers: {"x-qr-csrf": "yes"}
        }), 403, "FORBIDDEN");
        expect((await call(codes.GET, "GET", "/api/codes")).json.data.total).toBe(0);
    });
    it("cross-origin requests are blocked, same-origin and the configured app origin pass", async () => {
        for (const origin of ["https://evil.example", "https://qr.test.evil.example", "http://qr.test:3000"]) {
            const e = err(await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl(), origin}), 403, "FORBIDDEN");
            expect(e.message).toBe("Cross-origin request blocked");
        }
        ok(await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl(), origin: "https://qr.test"}), 201);
        ok(await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl(), origin: null}), 201);
    });
    it("a rejected request never reaches the handler (no side effects)", async () => {
        session(null);
        await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl({slug: "never-created"})});
        session(OWNER);
        expect(await (await T.raw()).exists(T.key("slug:never-created"))).toBe(0);
    });
    it("throttles an owner after 600 changes a minute", async () => {
        vi.useFakeTimers({toFake: ["Date"]});
        vi.setSystemTime(new Date("2027-06-01T12:00:30Z"));
        try {
            const req = () => new Request("https://qr.test/x", {method: "POST", headers: {"x-qr-csrf": "1"}});
            for (let i = 0; i < 600; i++) await requireOwner(req());
            await expect(requireOwner(req())).rejects.toMatchObject({
                code: "RATE_LIMITED",
                headers: {"Retry-After": "60"}
            });
            await expect(requireOwner(new Request("https://qr.test/x"))).resolves.toEqual({email: "owner@qr.test"});
        } finally {
            vi.useRealTimers();
        }
    });
    it("ownerRoute turns any thrown error into the envelope", async () => {
        const h = ownerRoute(async () => {
            throw new Error("kaboom secret");
        });
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const r = await call(h, "GET", "/x");
        spy.mockRestore();
        expect(err(r, 500, "INTERNAL").message).toBe("Something went wrong");
        expect(r.raw).not.toContain("kaboom");
    });
});

describe("cron route", () => {
    const cronCall = async (auth?: string) => {
        const res = await cron.GET(new Request("https://qr.test/api/cron/backup", {headers: auth ? {authorization: auth} : {}}));
        return {status: res.status, json: await res.json(), headers: res.headers};
    };
    it("rejects missing and wrong secrets with the uniform 401 envelope", async () => {
        for (const a of [undefined, "", "Bearer wrong", `Bearer ${T.cron}x`, T.cron, `bearer ${T.cron}`]) {
            const r = await cronCall(a);
            err(r, 401, "UNAUTHENTICATED");
            expect(r.headers.get("cache-control")).toBe("no-store");
        }
    });
    it("is closed (501) when CRON_SECRET is not set, even for an empty bearer", async () => {
        vi.stubEnv("CRON_SECRET", "");
        err(await cronCall("Bearer "), 501, "NOT_CONFIGURED");
        err(await cronCall(), 501, "NOT_CONFIGURED");
    });
    it("runs a backup with the right secret: failure -> 500, success -> 200", async () => {
        const failed = await cronCall(`Bearer ${T.cron}`);
        expect(failed.status).toBe(500);
        expect(failed.json).toMatchObject({
            ok: false,
            outcome: "failed",
            error: expect.stringContaining("not configured")
        });
        expect(failed.headers.get("cache-control")).toBe("no-store");

        const gh = installFakeGithub();
        vi.stubEnv("BACKUP_GITHUB_REPO", "owner/repo");
        vi.stubEnv("BACKUP_GITHUB_TOKEN", "ghp_x");
        await seedLibrary();
        const good = await cronCall(`Bearer ${T.cron}`);
        expect(good.status).toBe(200);
        expect(good.json).toMatchObject({ok: true, outcome: "created", records: 6});
        expect(good.json.name).toMatch(/^qr-/);
        expect(gh.puts()).toBe(1);
        const again = await cronCall(`Bearer ${T.cron}`);
        expect(again.json).toMatchObject({ok: true, outcome: "unchanged"});
    });
    it("skips with 200 on an uninitialised library", async () => {
        installFakeGithub();
        vi.stubEnv("BACKUP_GITHUB_REPO", "owner/repo");
        vi.stubEnv("BACKUP_GITHUB_TOKEN", "ghp_x");
        await T.reset();
        expect(await cronCall(`Bearer ${T.cron}`)).toMatchObject({status: 200, json: {ok: true, outcome: "skipped"}});
    });
});

describe("/api/health", () => {
    it("is public, minimal and uncached", async () => {
        session(null);
        const res = await health.GET();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ok: true});
        expect(res.headers.get("cache-control")).toBe("no-store");
    });
});

describe("/api/codes", () => {
    it("POST creates (201) and the view never exposes the password hash", async () => {
        const data = ok(await call(codes.POST, "POST", "/api/codes", {
            body: dynamicUrl({
                slug: "api-1",
                password: "pw-1234",
                tags: ["A", " b "].map((t) => t.trim().toLowerCase())
            })
        }), 201);
        expect(data).toMatchObject({
            slug: "api-1",
            rev: 1,
            hasPassword: true,
            scans: 0,
            linkState: "ok",
            status: "active"
        });
        expect(data).not.toHaveProperty("password");
        expect(JSON.stringify(data)).not.toContain("scrypt");
    });
    it("sets no-store on every kind of response", async () => {
        for (const r of [
            await call(codes.GET, "GET", "/api/codes"),
            await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl()}),
            await call(codes.POST, "POST", "/api/codes", {body: {}}),
            await call(codes.POST, "POST", "/api/codes", {raw: "{bad"}),
            await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl({slug: "dupe-slug"})}),
            await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl({slug: "dupe-slug"})}),
        ]) {
            expect(r.headers.get("cache-control")).toBe("no-store");
            expect(r.headers.get("content-type")).toMatch(/application\/json/);
        }
    });
    it("Zod failures -> 400 BAD_REQUEST with path/message details", async () => {
        const e = err(await call(codes.POST, "POST", "/api/codes", {
            body: {
                name: "",
                type: "nope",
                mode: "static",
                payload: "x"
            }
        }), 400, "BAD_REQUEST");
        expect(e.message).toBe("Invalid request");
        expect(Array.isArray(e.details)).toBe(true);
        expect(e.details.map((d: {
            path: string
        }) => d.path)).toEqual(expect.arrayContaining(["name", "type", "style"]));
        for (const d of e.details) expect(d).toEqual({path: expect.any(String), message: expect.any(String)});
    });
    it("invalid JSON -> 400, empty body -> validation error", async () => {
        expect(err(await call(codes.POST, "POST", "/api/codes", {raw: "{nope"}), 400, "BAD_REQUEST").message).toBe("Body must be valid JSON");
        err(await call(codes.POST, "POST", "/api/codes", {raw: ""}), 400, "BAD_REQUEST");
    });
    it("oversized bodies -> 413 PAYLOAD_TOO_LARGE (declared and actual)", async () => {
        err(await call(codes.POST, "POST", "/api/codes", {raw: JSON.stringify({name: "x".repeat(300_000)})}), 413, "PAYLOAD_TOO_LARGE");
        err(await call(codes.POST, "POST", "/api/codes", {
            body: dynamicUrl(),
            headers: {"content-length": "9999999"}
        }), 413, "PAYLOAD_TOO_LARGE");
    });
    it("domain errors keep their code: SLUG_TAKEN 409, bad destination 400, wifi without key 501", async () => {
        await newCode({slug: "taken-api"});
        err(await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl({slug: "taken-api"})}), 409, "SLUG_TAKEN");
        const e = err(await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl({payload: "javascript:alert(1)"})}), 400, "BAD_REQUEST");
        expect(e.message).toContain("Only http and https");
        vi.stubEnv("DATA_ENCRYPTION_KEY", "");
        err(await call(codes.POST, "POST", "/api/codes", {body: wifi()}), 501, "NOT_CONFIGURED");
    });
    it("blocks creation until the library is initialised -> 409 RECOVERY_REQUIRED", async () => {
        await T.reset();
        err(await call(codes.POST, "POST", "/api/codes", {body: dynamicUrl()}), 409, "RECOVERY_REQUIRED");
    });
    it("create is idempotent on opId", async () => {
        const body = dynamicUrl({id: "offlineapi001", opId: "op-api-1", slug: "offline-api"});
        const a = ok(await call(codes.POST, "POST", "/api/codes", {body}), 201);
        const b = ok(await call(codes.POST, "POST", "/api/codes", {body}), 201);
        expect(b).toEqual(a);
    });

    describe("GET (list)", () => {
        it("filters, searches and paginates", async () => {
            await newCode({name: "Menu", slug: "list-menu", tags: ["food"]});
            await newCode({name: "Promo", slug: "list-promo", favorite: true});
            const stat = ok(await call(codes.POST, "POST", "/api/codes", {body: staticText({name: "Static note"})}), 201);
            await call(codeId.DELETE, "DELETE", `/api/codes/${stat.id}`, {params: {id: stat.id}});
            const list = async (q = "") => ok(await call(codes.GET, "GET", `/api/codes${q}`));
            expect((await list()).total).toBe(2);
            expect((await list("?q=menu")).items.map((i: { name: string }) => i.name)).toEqual(["Menu"]);
            expect((await list("?tag=food")).total).toBe(1);
            expect((await list("?favorite=1")).items[0].name).toBe("Promo");
            expect((await list("?status=trashed")).items.map((i: { name: string }) => i.name)).toEqual(["Static note"]);
            expect((await list("?status=all")).total).toBe(3);
            expect((await list("?mode=static&status=all")).total).toBe(1);
            expect((await list("?sort=name&dir=asc")).items.map((i: {
                name: string
            }) => i.name)).toEqual(["Menu", "Promo"]);
            const page = await list("?sort=name&dir=asc&limit=1&offset=1");
            expect(page).toMatchObject({total: 2, items: [{name: "Promo"}], unreadable: []});
        });
        it("reports live scan counts and link state", async () => {
            const c = await newCode({slug: "live-state", scanLimit: 1});
            const {acceptScan} = await import("@/lib/redis/repo");
            await acceptScan({id: c.id, limit: 1, analytics: true, retentionDays: 90, device: "mobile"});
            const item = ok(await call(codes.GET, "GET", "/api/codes")).items[0];
            expect(item).toMatchObject({scans: 1, linkState: "exhausted"});
        });
        it("lists unreadable records separately instead of failing", async () => {
            const c = await newCode({slug: "will-break"});
            await (await T.raw()).set(T.key(`code:${c.id}`), "{broken");
            expect(ok(await call(codes.GET, "GET", "/api/codes"))).toMatchObject({total: 0, unreadable: [c.id]});
        });
    });
});

describe("/api/codes/[id]", () => {
    const P = (id: string) => ({params: {id}});
    it("GET returns the view, 404s unknown ids and 400s malformed ones", async () => {
        const c = await newCode({slug: "get-one"});
        expect(ok(await call(codeId.GET, "GET", `/api/codes/${c.id}`, P(c.id)))).toMatchObject({
            id: c.id,
            slug: "get-one",
            scans: 0
        });
        err(await call(codeId.GET, "GET", "/api/codes/zzzzzzzzzzzz", P("zzzzzzzzzzzz")), 404, "NOT_FOUND");
        err(await call(codeId.GET, "GET", "/api/codes/BAD", P("BAD")), 400, "BAD_REQUEST");
        err(await call(codeId.GET, "GET", "/api/codes/x", P("../../etc")), 400, "BAD_REQUEST");
    });
    it("PATCH changes only what was sent (regression: absent fields must not be reset to defaults)", async () => {
        const c = await newCode({
            slug: "patch-me",
            tags: ["keep"],
            favorite: true,
            pinned: true,
            scanLimit: 5,
            analytics: false,
            description: "desc",
            enabled: false
        });
        const patched = ok(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {ifRev: 1, name: "Renamed"}
        }));
        expect(patched).toMatchObject({
            name: "Renamed",
            rev: 2,
            tags: ["keep"],
            favorite: true,
            pinned: true,
            scanLimit: 5,
            analytics: false,
            description: "desc",
            enabled: false,
            status: "active",
            slug: "patch-me",
            mode: "dynamic",
            payload: DEST
        });
        const fresh = (await getCode(c.id))!;
        expect(fresh.style).toEqual(c.style);
        expect(fresh.schedule).toEqual(c.schedule);
    });
    it("PATCH ignores attempts to change id / createdAt / rev", async () => {
        const c = await newCode({slug: "immutable-api"});
        const p = ok(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {
                ifRev: 1,
                id: "hijacked00001",
                createdAt: "2001-01-01T00:00:00Z",
                rev: 50,
                password: undefined,
                name: "x"
            }
        }));
        expect(p).toMatchObject({id: c.id, createdAt: c.createdAt, rev: 2});
    });
    it("PATCH requires ifRev and reports REV_MISMATCH with the current version", async () => {
        const c = await newCode({slug: "rev-api"});
        err(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {name: "no rev"}
        }), 400, "BAD_REQUEST");
        ok(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {...P(c.id), body: {ifRev: 1, name: "v2"}}));
        const e = err(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {ifRev: 1, name: "stale"}
        }), 409, "REV_MISMATCH");
        expect(e.details.current).toMatchObject({name: "v2", rev: 2});
        expect(e.details.current).not.toHaveProperty("password");
    });
    it("PATCH sets and clears a link password", async () => {
        const c = await newCode({slug: "pw-api"});
        expect(ok(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {ifRev: 1, password: "newpass1"}
        })).hasPassword).toBe(true);
        expect(ok(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {ifRev: 2, password: null}
        })).hasPassword).toBe(false);
        err(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {ifRev: 3, password: "abc"}
        }), 400, "BAD_REQUEST");
    });
    it("PATCH validates the merged record", async () => {
        const c = await newCode({slug: "merge-api"});
        err(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {ifRev: 1, payload: "http://192.168.1.1/"}
        }), 400, "BAD_REQUEST");
        err(await call(codeId.PATCH, "PATCH", `/api/codes/${c.id}`, {
            ...P(c.id),
            body: {ifRev: 1, slug: "x"}
        }), 400, "BAD_REQUEST");
    });
    it("DELETE moves to the trash (and unpins); ?permanent=1 only works from the trash", async () => {
        const c = await newCode({slug: "del-api", pinned: true});
        err(await call(codeId.DELETE, "DELETE", `/api/codes/${c.id}?permanent=1`, P(c.id)), 400, "BAD_REQUEST");
        expect(ok(await call(codeId.DELETE, "DELETE", `/api/codes/${c.id}`, P(c.id)))).toMatchObject({
            status: "trashed",
            pinned: false
        });
        expect(ok(await call(codeId.DELETE, "DELETE", `/api/codes/${c.id}?permanent=1`, P(c.id)))).toEqual({
            id: c.id,
            purged: true
        });
        err(await call(codeId.GET, "GET", `/api/codes/${c.id}`, P(c.id)), 404, "NOT_FOUND");
        err(await call(codeId.DELETE, "DELETE", `/api/codes/${c.id}`, P(c.id)), 404, "NOT_FOUND");
        expect(await (await T.raw()).exists(T.key("slug:del-api"))).toBe(0);
    });
    it("duplicate copies content but not the password, and takes a fresh slug", async () => {
        const c = await newCode({slug: "dup-src", password: "pw-1234", tags: ["x"], name: "Original"});
        const d = ok(await call(codeDup.POST, "POST", `/api/codes/${c.id}/duplicate`, P(c.id)), 201);
        expect(d).toMatchObject({name: "Original (copy)", hasPassword: false, tags: ["x"], payload: DEST, rev: 1});
        expect(d.id).not.toBe(c.id);
        expect(d.slug).not.toBe("dup-src");
        err(await call(codeDup.POST, "POST", "/api/codes/zzzzzzzzzzzz/duplicate", P("zzzzzzzzzzzz")), 404, "NOT_FOUND");
    });
    it("per-code analytics", async () => {
        const c = await newCode({slug: "an-one"});
        const {acceptScan} = await import("@/lib/redis/repo");
        await acceptScan({id: c.id, limit: null, analytics: true, retentionDays: 90, device: "mobile"});
        const d = ok(await call(codeAnalytics.GET, "GET", `/api/codes/${c.id}/analytics?days=7`, P(c.id)));
        expect(d.totals.scans).toBe(1);
        expect(d.daily).toHaveLength(7);
        expect(ok(await call(codeAnalytics.GET, "GET", `/api/codes/${c.id}/analytics?days=9999`, P(c.id))).daily).toHaveLength(365);
        err(await call(codeAnalytics.GET, "GET", "/api/codes/x/analytics", P("BAD ID")), 400, "BAD_REQUEST");
    });
});

describe("/api/codes/batch", () => {
    it("applies an action to many codes and reports per id", async () => {
        const a = await newCode({slug: "batch-a"});
        const b = await newCode({slug: "batch-b", tags: ["old"]});
        const r = ok(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [a.id, b.id, "zzzzzzzzzzzz"],
                action: "archive"
            }
        }));
        expect(r.succeeded).toBe(2);
        expect(r.results).toEqual([{id: a.id, ok: true}, {id: b.id, ok: true}, {
            id: "zzzzzzzzzzzz",
            ok: false,
            error: "Not found"
        }]);
        expect((await getCode(a.id))!.status).toBe("archived");
        ok(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [a.id, b.id],
                action: "tag-add",
                value: "New"
            }
        }));
        expect((await getCode(b.id))!.tags).toEqual(["old", "new"]);
        ok(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [b.id],
                action: "tag-remove",
                value: "old"
            }
        }));
        expect((await getCode(b.id))!.tags).toEqual(["new"]);
        ok(await call(batch.POST, "POST", "/api/codes/batch", {body: {ids: [a.id], action: "pin"}}));
        expect((await getCode(a.id))!.pinned).toBe(true);
        ok(await call(batch.POST, "POST", "/api/codes/batch", {body: {ids: [a.id], action: "disable"}}));
        expect((await getCode(a.id))!.enabled).toBe(false);
    });
    it("move-folder, apply-template and purge", async () => {
        const a = await newCode({slug: "batch-m"});
        const f = ok(await call(folders.POST, "POST", "/api/folders", {body: {name: "F"}}), 201);
        ok(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [a.id],
                action: "move-folder",
                value: f.id
            }
        }));
        expect((await getCode(a.id))!.folder).toBe(f.id);
        const bad = ok(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [a.id],
                action: "move-folder",
                value: "nofolder00001"
            }
        }));
        expect(bad.results[0]).toEqual({id: a.id, ok: false, error: "Folder does not exist"});
        const t = ok(await call(templates.POST, "POST", "/api/templates", {
            body: {
                name: "T",
                style: {...defaultStyle(), fg: "#202020"}
            }
        }), 201);
        ok(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [a.id],
                action: "apply-template",
                value: t.id
            }
        }));
        expect((await getCode(a.id))!.style.fg).toBe("#202020");
        err(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [a.id],
                action: "apply-template",
                value: "missing000001"
            }
        }), 404, "NOT_FOUND");
        expect(ok(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [a.id],
                action: "purge"
            }
        })).results[0].ok).toBe(false);
        await call(batch.POST, "POST", "/api/codes/batch", {body: {ids: [a.id], action: "trash"}});
        expect(ok(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [a.id, a.id],
                action: "purge"
            }
        })).results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
    });
    it("validates the request", async () => {
        err(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: [],
                action: "archive"
            }
        }), 400, "BAD_REQUEST");
        err(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: ["zzzzzzzzzzzz"],
                action: "explode"
            }
        }), 400, "BAD_REQUEST");
        err(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: Array.from({length: 201}, () => "zzzzzzzzzzzz"),
                action: "archive"
            }
        }), 400, "BAD_REQUEST");
        err(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: ["zzzzzzzzzzzz"],
                action: "tag-add"
            }
        }), 400, "BAD_REQUEST");
        err(await call(batch.POST, "POST", "/api/codes/batch", {
            body: {
                ids: ["BAD"],
                action: "archive"
            }
        }), 400, "BAD_REQUEST");
    });
});

describe("/api/codes/bulk", () => {
    it("creates independently and reports each row in the envelope", async () => {
        await newCode({slug: "bulk-taken"});
        const r = ok(
            await call(bulk.POST, "POST", "/api/codes/bulk", {
                body: {
                    items: [dynamicUrl({slug: "bulk-1"}), {nonsense: true}, dynamicUrl({slug: "bulk-taken"}), dynamicUrl({payload: "javascript:1"}), staticText(), dynamicUrl({
                        slug: "bulk-2",
                        name: "Two"
                    })]
                },
            }),
        );
        expect(r.created).toBe(3);
        expect(r.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, false, false, false, true, true]);
        expect(r.results[1].error.code).toBe("BAD_REQUEST");
        expect(r.results[2].error).toMatchObject({code: "SLUG_TAKEN", message: expect.any(String)});
        expect(r.results[3].error.code).toBe("BAD_REQUEST");
        expect(r.results[0].data).toMatchObject({slug: "bulk-1", hasPassword: false});
        expect(r.results[0].data).not.toHaveProperty("password");
    });
    it("limits the batch and the body size", async () => {
        err(await call(bulk.POST, "POST", "/api/codes/bulk", {body: {items: []}}), 400, "BAD_REQUEST");
        err(await call(bulk.POST, "POST", "/api/codes/bulk", {body: {items: Array.from({length: 201}, () => ({}))}}), 400, "BAD_REQUEST");
        err(await call(bulk.POST, "POST", "/api/codes/bulk", {raw: JSON.stringify({items: ["x".repeat(2_200_000)]})}), 413, "PAYLOAD_TOO_LARGE");
    });
});

describe("/api/settings", () => {
    it("GET defaults, PUT persists and validates", async () => {
        expect(ok(await call(settings.GET, "GET", "/api/settings"))).toMatchObject({
            format: "png",
            brand: {name: "QR Studio"}
        });
        const saved = ok(await call(settings.PUT, "PUT", "/api/settings", {
            body: {
                brand: {name: "Acme"},
                analytics: {retentionDays: 30},
                mode: "dynamic"
            }
        }));
        expect(saved).toMatchObject({brand: {name: "Acme"}, mode: "dynamic", updatedAt: expect.any(String)});
        expect(ok(await call(settings.GET, "GET", "/api/settings"))).toEqual(saved);
        const e = err(await call(settings.PUT, "PUT", "/api/settings", {body: {analytics: {retentionDays: 1}}}), 400, "BAD_REQUEST");
        expect(e.details[0].path).toBe("analytics.retentionDays");
        err(await call(settings.PUT, "PUT", "/api/settings", {body: {brand: {accent: "red"}}}), 400, "BAD_REQUEST");
        err(await call(settings.PUT, "PUT", "/api/settings", {body: {theme: "x"}, csrf: false}), 403, "FORBIDDEN");
    });
});

describe("folders, templates, tags", () => {
    it("folders: create, list with counts, rename, delete (un-files codes)", async () => {
        const f = ok(await call(folders.POST, "POST", "/api/folders", {body: {name: " Work ", color: "#123456"}}), 201);
        expect(f).toMatchObject({name: "Work", color: "#123456"});
        const c = await newCode({slug: "in-folder-api", folder: f.id});
        expect(ok(await call(folders.GET, "GET", "/api/folders"))).toEqual([{...f, count: 1}]);
        expect(ok(await call(folderId.PATCH, "PATCH", `/api/folders/${f.id}`, {
            params: {id: f.id},
            body: {name: "Office"}
        }))).toMatchObject({id: f.id, name: "Office", createdAt: f.createdAt});
        err(await call(folderId.PATCH, "PATCH", "/api/folders/zzzzzzzzzzzz", {
            params: {id: "zzzzzzzzzzzz"},
            body: {name: "x"}
        }), 404, "NOT_FOUND");
        err(await call(folders.POST, "POST", "/api/folders", {body: {name: ""}}), 400, "BAD_REQUEST");
        err(await call(folders.POST, "POST", "/api/folders", {body: {name: "x", color: "blue"}}), 400, "BAD_REQUEST");
        expect(ok(await call(folderId.DELETE, "DELETE", `/api/folders/${f.id}`, {params: {id: f.id}}))).toEqual({unfiled: 1});
        expect((await getCode(c.id))!.folder).toBeNull();
    });
    it("templates: create, list, rename, delete", async () => {
        const t = ok(await call(templates.POST, "POST", "/api/templates", {
            body: {
                name: "Brand",
                style: {fg: "#101010"}
            }
        }), 201);
        expect(t.style.fg).toBe("#101010");
        expect(t.style.bg).toBe("#ffffff");
        expect(ok(await call(templates.GET, "GET", "/api/templates"))).toHaveLength(1);
        expect(ok(await call(templateId.PATCH, "PATCH", `/api/templates/${t.id}`, {
            params: {id: t.id},
            body: {name: "Brand 2", style: t.style}
        })).name).toBe("Brand 2");
        err(await call(templates.POST, "POST", "/api/templates", {
            body: {
                name: "x",
                style: {fg: "nope"}
            }
        }), 400, "BAD_REQUEST");
        expect(ok(await call(templateId.DELETE, "DELETE", `/api/templates/${t.id}`, {params: {id: t.id}}))).toEqual({deleted: true});
        expect(ok(await call(templates.GET, "GET", "/api/templates"))).toEqual([]);
    });
    it("tags: list, rename, delete", async () => {
        await newCode({slug: "tag-api-1", tags: ["a", "b"]});
        await newCode({slug: "tag-api-2", tags: ["a"]});
        expect(ok(await call(tags.GET, "GET", "/api/tags"))).toEqual([{tag: "a", count: 2}, {tag: "b", count: 1}]);
        expect(ok(await call(tags.POST, "POST", "/api/tags", {body: {from: "A", to: "z"}}))).toEqual({updated: 2});
        expect(ok(await call(tags.POST, "POST", "/api/tags", {body: {from: "b", to: null}}))).toEqual({updated: 1});
        expect(ok(await call(tags.GET, "GET", "/api/tags"))).toEqual([{tag: "z", count: 2}]);
        err(await call(tags.POST, "POST", "/api/tags", {body: {from: "", to: "x"}}), 400, "BAD_REQUEST");
    });
});

describe("assets", () => {
    it("stores a logo, serves it with immutable caching, and rejects bad input", async () => {
        const {id} = ok(await call(assets.POST, "POST", "/api/assets", {body: {dataUrl: pngDataUrl()}}), 201);
        const got = await call(assetId.GET, "GET", `/api/assets/${id}`, {params: {id}});
        expect(ok(got)).toEqual({dataUrl: pngDataUrl()});
        expect(got.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
        err(await call(assetId.GET, "GET", `/api/assets/${"a".repeat(32)}`, {params: {id: "a".repeat(32)}}), 404, "NOT_FOUND");
        err(await call(assets.POST, "POST", "/api/assets", {body: {dataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`}}), 400, "BAD_REQUEST");
        err(await call(assets.POST, "POST", "/api/assets", {body: {dataUrl: pngDataUrl(20_000)}}), 400, "BAD_REQUEST");
        err(await call(assets.POST, "POST", "/api/assets", {body: {dataUrl: pngDataUrl(14_000)}}), 413, "PAYLOAD_TOO_LARGE");
        err(await call(assets.POST, "POST", "/api/assets", {raw: JSON.stringify({dataUrl: "x".repeat(40_000)})}), 413, "PAYLOAD_TOO_LARGE");
    });
});

describe("analytics routes", () => {
    it("JSON report and CSV export", async () => {
        const c = await newCode({slug: "csv-1", name: "=HYPERLINK(1)"});
        const {acceptScan} = await import("@/lib/redis/repo");
        await acceptScan({id: c.id, limit: null, analytics: true, retentionDays: 90, device: "mobile"});
        const json = ok(await call(analytics.GET, "GET", "/api/analytics"));
        expect(json).toMatchObject({enabled: true, totals: {scans: 1, codes: 1}});
        expect(json.daily).toHaveLength(30);
        const csv = await analytics.GET(new Request("https://qr.test/api/analytics?format=csv"), {params: Promise.resolve({})});
        expect(csv.status).toBe(200);
        expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        expect(csv.headers.get("cache-control")).toBe("no-store");
        expect(csv.headers.get("content-disposition")).toMatch(/^attachment; filename="qr-analytics-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/);
        const body = await csv.text();
        expect(body.split("\r\n")[0]).toBe("section,key,value");
        expect(body).toContain("top,'=HYPERLINK(1),1");
        expect(body).toContain("device,mobile,1");
    });
    it("validates dates and ids", async () => {
        err(await call(analytics.GET, "GET", "/api/analytics?from=yesterday"), 400, "BAD_REQUEST");
        err(await call(analytics.GET, "GET", "/api/analytics?from=2027-02-30x"), 400, "BAD_REQUEST");
        err(await call(analytics.GET, "GET", "/api/analytics?from=2027-03-02&to=2027-03-01"), 400, "BAD_REQUEST");
        err(await call(analytics.GET, "GET", "/api/analytics?id=NOT_AN_ID"), 400, "BAD_REQUEST");
        expect(ok(await call(analytics.GET, "GET", "/api/analytics?from=2027-03-01&to=2027-03-03")).daily.map((d: {
            day: string
        }) => d.day)).toEqual(["2027-03-01", "2027-03-02", "2027-03-03"]);
    });
    it("reset requires explicit confirmation", async () => {
        const c = await newCode({slug: "reset-api"});
        const {acceptScan} = await import("@/lib/redis/repo");
        await acceptScan({id: c.id, limit: null, analytics: true, retentionDays: 90, device: "mobile"});
        err(await call(analyticsReset.POST, "POST", "/api/analytics/reset", {body: {}}), 400, "BAD_REQUEST");
        err(await call(analyticsReset.POST, "POST", "/api/analytics/reset", {body: {confirm: "yes"}}), 400, "BAD_REQUEST");
        expect(await scanCount(c.id)).toBe(1);
        expect(ok(await call(analyticsReset.POST, "POST", "/api/analytics/reset", {
            body: {
                id: c.id,
                confirm: "reset"
            }
        })).deleted).toBeGreaterThan(0);
        expect(await scanCount(c.id)).toBe(0);
    });
});

describe("library export / import", () => {
    it("JSON export omits password hashes and round-trips through import", async () => {
        const s = await seedLibrary();
        const res = await libExport.GET(new Request("https://qr.test/api/library/export"), {params: Promise.resolve({})});
        expect(res.headers.get("content-type")).toBe("application/json");
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="qr-library-\d{4}-\d{2}-\d{2}\.json"$/);
        const text = await res.text();
        expect(text).not.toContain("scrypt$");
        const file = JSON.parse(text);
        expect(file).toMatchObject({format: "qr-studio-library", version: 1});
        expect(file.codes).toHaveLength(6);
        const alpha = file.codes.find((c: { id: string }) => c.id === s.alpha.id);
        expect(alpha).toMatchObject({password: null, hadPassword: true});
        expect(file.folders[0]).not.toHaveProperty("count");

        await T.reset();
        await initMeta();
        const dry = ok(await call(libImport.POST, "POST", "/api/library/import", {body: {data: file}}));
        expect(dry).toMatchObject({dryRun: true, created: 6});
        expect(await (await T.raw()).exists(T.key(`code:${s.alpha.id}`))).toBe(0);
        const applied = ok(await call(libImport.POST, "POST", "/api/library/import", {
            body: {
                data: file,
                dryRun: false,
                policy: "skip"
            }
        }));
        expect(applied).toMatchObject({dryRun: false, created: 6, invalid: []});
        expect(await getCode(s.alpha.id)).toMatchObject({name: "Alpha Menu", password: null});
    });
    it("CSV export hides sensitive payloads and neutralises formulas", async () => {
        await newCode({slug: "csv-exp", name: "=cmd|calc"});
        await createCode(wifi());
        const res = await libExport.GET(new Request("https://qr.test/api/library/export?format=csv"), {params: Promise.resolve({})});
        expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        const csv = await res.text();
        expect(csv).toContain("'=cmd|calc");
        expect(csv).toContain("(sensitive");
        expect(csv).not.toContain("hunter2");
        expect(csv).toContain("https://qr.test/r/csv-exp");
    });
    it("import validates the body and the file", async () => {
        err(await call(libImport.POST, "POST", "/api/library/import", {body: {data: {nope: true}}}), 400, "BAD_REQUEST");
        err(await call(libImport.POST, "POST", "/api/library/import", {
            body: {
                data: {},
                policy: "merge"
            }
        }), 400, "BAD_REQUEST");
        err(await call(libImport.POST, "POST", "/api/library/import", {raw: "x".repeat(9 * 1024 * 1024)}), 413, "PAYLOAD_TOO_LARGE");
    });
    it("export requires the owner", async () => {
        session(null);
        err(await call(libExport.GET, "GET", "/api/library/export"), 401, "UNAUTHENTICATED");
    });
});

describe("backup routes", () => {
    it("GET reports configuration, freshness and history", async () => {
        expect(ok(await call(backup.GET, "GET", "/api/backup"))).toMatchObject({
            configured: false,
            freshness: {state: "unconfigured"},
            snapshots: [],
            listError: null
        });
        const gh = installFakeGithub();
        vi.stubEnv("BACKUP_GITHUB_REPO", "owner/repo");
        vi.stubEnv("BACKUP_GITHUB_TOKEN", "ghp_x");
        await seedLibrary();
        const run = ok(await call(backup.POST, "POST", "/api/backup"));
        expect(run).toMatchObject({outcome: "created", trigger: "manual", records: 6});
        const got = ok(await call(backup.GET, "GET", "/api/backup"));
        expect(got).toMatchObject({
            configured: true,
            freshness: {state: "ok"},
            snapshots: [{name: run.name}],
            listError: null
        });
        expect(got.status.history[0].outcome).toBe("created");
        gh.mode.rateLimit = "GET";
        expect(ok(await call(backup.GET, "GET", "/api/backup")).listError).toMatch(/rate limit/i);
    });
    it("POST is throttled to 3 per minute", async () => {
        vi.useFakeTimers({toFake: ["Date"]});
        vi.setSystemTime(new Date("2027-06-01T12:00:30Z"));
        try {
            for (let i = 0; i < 3; i++) expect(ok(await call(backup.POST, "POST", "/api/backup")).outcome).toBe("failed");
            const e = err(await call(backup.POST, "POST", "/api/backup"), 429, "RATE_LIMITED");
            expect(e.message).toMatch(/3 times a minute/);
        } finally {
            vi.useRealTimers();
        }
    });
    it("download returns an encrypted file only", async () => {
        await seedLibrary();
        const res = await backupDownload.GET(new Request("https://qr.test/api/backup/download"), {params: Promise.resolve({})});
        expect(res.status).toBe(200);
        expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="qr-studio-\d{4}-\d{2}-\d{2}\.qrbackup\.json"$/);
        expect(res.headers.get("cache-control")).toBe("no-store");
        const text = await res.text();
        expect(text).not.toContain("bk-alpha");
        const {unpackSnapshot} = await import("@/lib/backup/snapshot");
        expect(unpackSnapshot(text, T.backupKey).snapshot.codes).toHaveLength(6);
    });
    it("download: 501 without a key, 409 on an uninitialised library", async () => {
        vi.stubEnv("BACKUP_ENCRYPTION_KEY", "");
        err(await call(backupDownload.GET, "GET", "/api/backup/download"), 501, "NOT_CONFIGURED");
        vi.unstubAllEnvs();
        await T.reset();
        err(await call(backupDownload.GET, "GET", "/api/backup/download"), 409, "RECOVERY_REQUIRED");
    });
    it("restore: dry run by default, replace needs typed confirmation, bad files are 400", async () => {
        const s = await seedLibrary();
        const dl = await backupDownload.GET(new Request("https://qr.test/api/backup/download"), {params: Promise.resolve({})});
        const text = await dl.text();
        const dry = ok(await call(backupRestore.POST, "POST", "/api/backup/restore", {body: {source: {text}}}));
        expect(dry.report).toMatchObject({
            dryRun: true,
            applied: false,
            mode: "merge",
            prefer: "newer",
            codes: {unchanged: 6}
        });
        expect(dry.envelope).toMatchObject({recordCount: 6});
        err(await call(backupRestore.POST, "POST", "/api/backup/restore", {
            body: {
                source: {text},
                dryRun: false,
                mode: "replace"
            }
        }), 400, "BAD_REQUEST");
        err(await call(backupRestore.POST, "POST", "/api/backup/restore", {
            body: {
                source: {text},
                dryRun: false,
                mode: "replace",
                confirm: "nope"
            }
        }), 400, "BAD_REQUEST");
        expect(ok(await call(backupRestore.POST, "POST", "/api/backup/restore", {
            body: {
                source: {text},
                dryRun: false,
                mode: "replace",
                confirm: "replace"
            }
        })).report.applied).toBe(true);
        err(await call(backupRestore.POST, "POST", "/api/backup/restore", {body: {source: {text: "garbage"}}}), 400, "BAD_REQUEST");
        err(await call(backupRestore.POST, "POST", "/api/backup/restore", {body: {source: {}}}), 400, "BAD_REQUEST");
        err(await call(backupRestore.POST, "POST", "/api/backup/restore", {body: {source: {text: text.slice(0, 100)}}}), 400, "BAD_REQUEST");
        expect(await getCode(s.alpha.id)).not.toBeNull();
    });
    it("restore without a configured key is NOT_CONFIGURED (501), not a 500", async () => {
        vi.stubEnv("BACKUP_ENCRYPTION_KEY", "");
        err(await call(backupRestore.POST, "POST", "/api/backup/restore", {body: {source: {text: "{}"}}}), 501, "NOT_CONFIGURED");
        vi.stubEnv("BACKUP_ENCRYPTION_KEY", Buffer.from("too short").toString("base64"));
        err(await call(backupRestore.POST, "POST", "/api/backup/restore", {body: {source: {text: "{}"}}}), 501, "NOT_CONFIGURED");
    });
});

describe("status and admin", () => {
    it("status describes configuration without secrets", async () => {
        const d = ok(await call(status.GET, "GET", "/api/status"));
        expect(d).toMatchObject({
            initialized: true,
            user: {email: "owner@qr.test"},
            sealing: true,
            redis: {ok: true},
            config: {redis: true, ownerEmails: 2, cron: true, backup: false, appUrl: "https://qr.test"}
        });
        const text = JSON.stringify(d);
        for (const secret of [T.dataKey, T.backupKey, T.cron, T.auth]) expect(text).not.toContain(secret);
        expect(text).not.toContain("localhost:6390");
    });
    it("status flags an uninitialised library as needing recovery", async () => {
        await T.reset();
        expect(ok(await call(status.GET, "GET", "/api/status"))).toMatchObject({
            initialized: false,
            recovery: {needed: true}
        });
    });
    it("admin/init needs a typed confirmation and is idempotent", async () => {
        await T.reset();
        err(await call(adminInit.POST, "POST", "/api/admin/init", {body: {}}), 400, "BAD_REQUEST");
        err(await call(adminInit.POST, "POST", "/api/admin/init", {body: {confirm: "yes"}}), 400, "BAD_REQUEST");
        const a = ok(await call(adminInit.POST, "POST", "/api/admin/init", {body: {confirm: "start-empty"}}));
        const b = ok(await call(adminInit.POST, "POST", "/api/admin/init", {body: {confirm: "start-empty"}}));
        expect(b).toEqual(a);
        expect(a).toMatchObject({schemaVersion: 1, instanceId: expect.any(String)});
    });
    it("admin/repair defaults to a dry run", async () => {
        await seedLibrary();
        await (await T.raw()).del(T.key("slug:bk-alpha"));
        const dry = ok(await call(adminRepair.POST, "POST", "/api/admin/repair", {body: {}}));
        expect(dry).toMatchObject({applied: false, slugFixed: 1});
        expect(await (await T.raw()).exists(T.key("slug:bk-alpha"))).toBe(0);
        expect(ok(await call(adminRepair.POST, "POST", "/api/admin/repair", {body: {apply: true}})).applied).toBe(true);
        expect(await (await T.raw()).exists(T.key("slug:bk-alpha"))).toBe(1);
    });
});

describe("every private endpoint is owner-only", () => {
    it("answers 401 for anonymous callers", async () => {
        session(null);
        const id = "abcdefgh1234";
        const P = {params: {id}};
        const calls: [unknown, string, string, Init?][] = [
            [codes.GET, "GET", "/api/codes"], [codes.POST, "POST", "/api/codes", {body: {}}],
            [codeId.GET, "GET", "/x", P], [codeId.PATCH, "PATCH", "/x", {
                ...P,
                body: {}
            }], [codeId.DELETE, "DELETE", "/x", P],
            [codeDup.POST, "POST", "/x", P], [codeAnalytics.GET, "GET", "/x", P], [batch.POST, "POST", "/x", {body: {}}], [bulk.POST, "POST", "/x", {body: {}}],
            [settings.GET, "GET", "/x"], [settings.PUT, "PUT", "/x", {body: {}}], [folders.GET, "GET", "/x"], [folders.POST, "POST", "/x", {body: {}}],
            [folderId.PATCH, "PATCH", "/x", {
                ...P,
                body: {}
            }], [folderId.DELETE, "DELETE", "/x", P], [templates.GET, "GET", "/x"], [templates.POST, "POST", "/x", {body: {}}],
            [templateId.PATCH, "PATCH", "/x", {
                ...P,
                body: {}
            }], [templateId.DELETE, "DELETE", "/x", P], [tags.GET, "GET", "/x"], [tags.POST, "POST", "/x", {body: {}}],
            [analytics.GET, "GET", "/x"], [analyticsReset.POST, "POST", "/x", {body: {}}], [libExport.GET, "GET", "/x"], [libImport.POST, "POST", "/x", {body: {}}],
            [backup.GET, "GET", "/x"], [backup.POST, "POST", "/x"], [backupDownload.GET, "GET", "/x"], [backupRestore.POST, "POST", "/x", {body: {}}],
            [status.GET, "GET", "/x"], [assets.POST, "POST", "/x", {body: {}}], [assetId.GET, "GET", "/x", P], [adminInit.POST, "POST", "/x", {body: {}}], [adminRepair.POST, "POST", "/x", {body: {}}],
        ];
        for (const [h, m, p, init] of calls) err(await call(h, m, p, init), 401, "UNAUTHENTICATED");
        expect(calls.length).toBeGreaterThan(30);
        expect(await T.keys()).toContain(T.key("meta:schema"));
        expect((await T.keys()).filter((k) => k.includes(":code:") || k.includes(":rl:"))).toEqual([]);
    });
});

it("JSON transfers logos and leaves previously password-protected imports paused", async () => {
    const seeded = await seedLibrary();
    const file = await (await libExport.GET(new Request("https://qr.test/api/library/export"), {params: Promise.resolve({})})).json();
    expect(file.assets[seeded.assetId]).toMatch(/^data:image/);
    await T.reset();
    await initMeta();
    const result = ok(await call(libImport.POST, "POST", "/api/library/import", {body: {data: file, dryRun: false}}));
    expect(result.created).toBe(6);
    expect(await (await T.raw()).get(T.key(`asset:${seeded.assetId}`))).toBe(file.assets[seeded.assetId]);
    const protectedRecords = file.codes.filter((c: { hadPassword: boolean }) => c.hadPassword);
    expect(protectedRecords.length).toBeGreaterThan(0);
    for (const c of protectedRecords) expect(await getCode(c.id)).toMatchObject({enabled: false, password: null});
});
