import { createClient, type RedisClientType } from "redis";
import { env } from "../env";
import { assertOwnKey } from "./keys";

export class RedisUnavailableError extends Error {
  constructor(message = "Redis is unavailable") {
    super(message);
    this.name = "RedisUnavailableError";
  }
}

type G = { __qrRedis?: { client: RedisClientType | null; connecting: Promise<RedisClientType> | null } };
const state = ((globalThis as G).__qrRedis ??= { client: null, connecting: null });

const OP_TIMEOUT_MS = 5_000;

/** One shared connection per function instance (Redis Cloud Free allows ~30 connections total). */
export async function getRedis(): Promise<RedisClientType> {
  const url = env.redisUrl();
  if (!url) throw new RedisUnavailableError("Redis is not configured");
  if (state.client?.isReady) return state.client;
  if (state.connecting) return state.connecting;

  const client = createClient({
    url,
    // Fail fast: a request must never hang on a dead socket. We reconnect lazily on the next call.
    socket: { connectTimeout: 3_000, reconnectStrategy: false, keepAlive: true },
    disableOfflineQueue: true,
  }) as RedisClientType;
  client.on("error", () => {
    // Never log: error messages can embed the connection URL.
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

/** Never replay a write after an ambiguous socket failure: Redis may already have committed it. */
export async function withRedis<T>(fn: (r: RedisClientType) => Promise<T>, retry = false): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await getRedis();
    return await Promise.race([
      fn(r),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new RedisUnavailableError("Redis timed out")), OP_TIMEOUT_MS); timer.unref?.(); }),
    ]);
  } catch (e) {
    if (isConnError(e)) {
      const c = state.client;
      state.client = null;
      if (c?.isOpen) c.destroy();
      if (retry) return withRedis(fn, false);
      throw e instanceof RedisUnavailableError ? e : new RedisUnavailableError();
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Lua helper: EVALSHA with NOSCRIPT fallback ----
const shas = new Map<string, string>();
export async function runScript(
  r: RedisClientType,
  name: string,
  src: string,
  keys: string[],
  args: (string | number)[],
): Promise<unknown> {
  keys.forEach(assertOwnKey);
  const arguments_ = args.map(String);
  let sha = shas.get(name);
  try {
    if (!sha) {
      sha = await r.scriptLoad(src);
      shas.set(name, sha);
    }
    return await r.evalSha(sha, { keys, arguments: arguments_ });
  } catch (e) {
    if (e instanceof Error && /NOSCRIPT/.test(e.message)) {
      shas.delete(name);
      return r.eval(src, { keys, arguments: arguments_ });
    }
    throw e;
  }
}
