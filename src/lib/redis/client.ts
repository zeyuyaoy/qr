import {createHash} from "node:crypto";
import {createClient, type RedisClientType} from "redis";
import {env} from "../env";
import {assertOwnKey} from "./keys";

export class RedisUnavailableError extends Error {
    constructor(message = "Redis is unavailable") {
        super(message);
        this.name = "RedisUnavailableError";
    }
}

type G = { __qrRedis?: { client: RedisClientType | null; connecting: Promise<RedisClientType> | null } };
const state = ((globalThis as G).__qrRedis ??= {client: null, connecting: null});

const OP_TIMEOUT_MS = 5_000;

export async function getRedis(): Promise<RedisClientType> {
    const url = env.redisUrl();
    if (!url) throw new RedisUnavailableError("Redis is not configured");
    if (state.client?.isReady) return state.client;
    if (state.connecting) return state.connecting;

    const client = createClient({
        url,
        socket: {connectTimeout: 3_000, reconnectStrategy: false, keepAlive: true},
        disableOfflineQueue: true,
    }) as RedisClientType;
    client.on("error", () => {
        if (state.client === client) state.client = null;
    });
    client.on("end", () => {
        if (state.client === client) state.client = null;
    });
    state.connecting = client
        .connect()
        .then(() => {
            state.client = client;
            return client;
        })
        .catch(() => {
            if (client.isOpen) client.destroy();
            throw new RedisUnavailableError();
        })
        .finally(() => {
            state.connecting = null;
        });
    return state.connecting;
}

export async function closeRedis(): Promise<void> {
    const c = state.client;
    state.client = null;
    state.connecting = null;
    if (c?.isOpen) await c.quit().catch(() => c.destroy());
}

const isConnError = (e: unknown) =>
    e instanceof RedisUnavailableError ||
    (e instanceof Error && /(Socket|ClientClosed|ClientOffline|Connection|ECONN|ETIMEDOUT|Timeout)/i.test(`${e.name} ${e.message}`));

export async function withRedis<T>(fn: (r: RedisClientType) => Promise<T>, retry = false): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let connection: RedisClientType | undefined;
    try {
        connection = await getRedis();
        return await Promise.race([
            fn(connection),
            new Promise<never>((_, rej) => {
                timer = setTimeout(() => rej(new RedisUnavailableError("Redis timed out")), OP_TIMEOUT_MS);
                timer.unref?.();
            }),
        ]);
    } catch (e) {
        if (isConnError(e)) {
            if (state.client === connection) state.client = null;
            if (connection?.isOpen) connection.destroy();
            if (retry) return withRedis(fn, false);
            throw e instanceof RedisUnavailableError ? e : new RedisUnavailableError();
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

const shas = new Map<string, string>();

export async function runScript(
    r: RedisClientType,
    name: string,
    src: string,
    keys: string[],
    args: (string | number)[],
): Promise<unknown> {
    keys.forEach(assertOwnKey);
    const options = {keys, arguments: args.map(String)};
    const sha = shas.get(name);
    if (!sha) {
        const result = await r.eval(src, options);
        shas.set(name, createHash("sha1").update(src).digest("hex"));
        return result;
    }
    try {
        return await r.evalSha(sha, options);
    } catch (e) {
        if (e instanceof Error && e.message.startsWith("NOSCRIPT")) return r.eval(src, options);
        throw e;
    }
}
