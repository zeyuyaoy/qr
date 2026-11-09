import {createServer} from "node:net";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {setupEnv} from "./helpers/env";

vi.mock("@/auth", () => ({auth: vi.fn()}));

const closedPort = () =>
    new Promise<number>((resolve, reject) => {
        const srv = createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const {port} = srv.address() as { port: number };
            srv.close(() => resolve(port));
        });
    });

const fresh = async () => {
    delete (globalThis as { __qrRedis?: unknown }).__qrRedis;
    vi.resetModules();
    const [{handleResolve}, {auth}, codes, health, repo, client, env] = await Promise.all([
        import("@/lib/resolve"),
        import("@/auth"),
        import("@/app/api/codes/route"),
        import("@/app/api/health/route"),
        import("@/lib/redis/repo"),
        import("@/lib/redis/client"),
        import("@/lib/env"),
    ]);
    vi.mocked(auth).mockResolvedValue({user: {email: "owner@qr.test", isOwner: true}, expires: "2999-01-01"} as never);
    return {handleResolve, codes, health, repo, client, env};
};

describe("Redis unreachable (closed port)", () => {
    beforeEach(async () => {
        setupEnv(`redis://127.0.0.1:${await closedPort()}`);
    });
    afterEach(() => vi.resetModules());

    it("the public resolver fails closed with a 503 page and never redirects", async () => {
        const {handleResolve} = await fresh();
        for (const method of ["GET", "HEAD", "POST"]) {
            const res = await handleResolve(new Request("https://qr.test/r/some-link", {method}), "some-link");
            expect(res.status, method).toBe(503);
            expect(res.headers.get("location")).toBeNull();
            expect(res.headers.get("retry-after")).toBe("30");
            expect(res.headers.get("cache-control")).toMatch(/no-store/);
            expect(await res.text()).toContain("Temporarily unavailable");
        }
    });
    it("the owner API answers with the REDIS_UNAVAILABLE envelope", async () => {
        const {codes} = await fresh();
        const res = await codes.GET(new Request("https://qr.test/api/codes"), {params: Promise.resolve({})});
        expect(res.status).toBe(503);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({
            ok: false,
            error: {code: "REDIS_UNAVAILABLE", message: "The database is temporarily unavailable. Try again shortly."}
        });
    });
    it("writes fail the same way", async () => {
        const {codes} = await fresh();
        const res = await codes.POST(
            new Request("https://qr.test/api/codes", {
                method: "POST",
                headers: {"x-qr-csrf": "1", "content-type": "application/json"},
                body: JSON.stringify({name: "n", type: "text", mode: "static", payload: "x", style: {}}),
            }),
            {params: Promise.resolve({})},
        );
        expect(res.status).toBe(503);
        expect((await res.json()).error.code).toBe("REDIS_UNAVAILABLE");
    });
    it("the health probe reports 503 without leaking details", async () => {
        const {health} = await fresh();
        const res = await health.GET();
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ok: false});
    });
    it("the connection URL never appears in an error", async () => {
        const {repo, env} = await fresh();
        const url = env.env.redisUrl()!;
        const err = await repo.getMeta().catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(url);
    });
});

describe("REDIS_URL missing", () => {
    beforeEach(() => {
        setupEnv();
        delete process.env.REDIS_URL;
        delete process.env.QR_REDIS_URL;
    });
    afterEach(() => vi.resetModules());

    it("explains that Redis is not configured", async () => {
        const {client, env} = await fresh();
        expect(env.configReport().redis).toBe(false);
        await expect(client.getRedis()).rejects.toThrow("Redis is not configured");
        await expect(client.getRedis()).rejects.toBeInstanceOf(client.RedisUnavailableError);
    });
    it("the resolver and API degrade to 503 instead of crashing", async () => {
        const {handleResolve, codes} = await fresh();
        expect((await handleResolve(new Request("https://qr.test/r/some-link"), "some-link")).status).toBe(503);
        const res = await codes.GET(new Request("https://qr.test/api/codes"), {params: Promise.resolve({})});
        expect(res.status).toBe(503);
        expect((await res.json()).error.code).toBe("REDIS_UNAVAILABLE");
    });
    it("QR_REDIS_URL is accepted as an alias", async () => {
        process.env.QR_REDIS_URL = "redis://127.0.0.1:6390";
        const {env} = await fresh();
        expect(env.env.redisUrl()).toBe("redis://127.0.0.1:6390");
    });
});
