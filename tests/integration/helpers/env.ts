/**
 * Safety + environment for the integration suites.
 *
 * - Refuses to run unless Redis is on this machine (localhost / 127.0.0.1 / ::1).
 * - Every test FILE gets its own random key prefix (`qr:test:<random>:`); the app honours it only when
 *   NODE_ENV === "test". Cleanup deletes keys under that prefix only (SCAN + UNLINK), never FLUSHDB/FLUSHALL.
 * - Must run BEFORE any app module is used: `env.*` reads process.env lazily, and the shared Redis client is
 *   created on first use, so importing `./boot` as the first import of a test file is enough.
 */
import { randomBytes } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

export const DEFAULT_REDIS_URL = "redis://localhost:6390";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertLocalRedis(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("Refusing to run integration tests: REDIS_URL is not a valid URL");
  }
  if (!LOCAL_HOSTS.has(host.toLowerCase())) {
    throw new Error(`Refusing to run integration tests against non-local Redis host "${host}". Use a disposable local Redis (bun run redis:test).`);
  }
}

const setEnv = (k: string, v: string | undefined) => {
  const e = process.env as Record<string, string | undefined>;
  if (v === undefined) delete e[k];
  else e[k] = v;
};

export type TestEnv = ReturnType<typeof setupEnv>;

export function setupEnv(redisUrl: string = process.env.REDIS_URL || DEFAULT_REDIS_URL) {
  assertLocalRedis(redisUrl);
  const prefix = `qr:test:${randomBytes(6).toString("hex")}:`;
  const secrets = {
    dataKey: randomBytes(32).toString("base64"),
    backupKey: randomBytes(32).toString("base64"),
    cron: randomBytes(16).toString("hex"),
    auth: randomBytes(16).toString("hex"),
  };
  setEnv("NODE_ENV", "test");
  setEnv("REDIS_URL", redisUrl);
  setEnv("QR_REDIS_URL", undefined);
  setEnv("QR_KEY_PREFIX", prefix);
  setEnv("DATA_ENCRYPTION_KEY", secrets.dataKey);
  setEnv("BACKUP_ENCRYPTION_KEY", secrets.backupKey);
  setEnv("AUTH_SECRET", secrets.auth);
  setEnv("NEXT_PUBLIC_APP_URL", "https://qr.test");
  setEnv("APP_URL", undefined);
  setEnv("OWNER_EMAILS", "owner@qr.test, Second@qr.test");
  setEnv("CRON_SECRET", secrets.cron);
  for (const k of ["BACKUP_GITHUB_REPO", "BACKUP_GITHUB_TOKEN", "BACKUP_GITHUB_BRANCH", "VERCEL", "VERCEL_ENV", "ENABLE_TEST_AUTH"]) setEnv(k, undefined);

  let client: RedisClientType | null = null;
  /** Independent client used only for assertions and cleanup (never the app's own connection). */
  const raw = async (): Promise<RedisClientType> => {
    if (!client) {
      client = createClient({ url: redisUrl, socket: { connectTimeout: 3000, reconnectStrategy: false } }) as RedisClientType;
      client.on("error", () => undefined);
      await client.connect();
    }
    return client;
  };
  const own = (k: string) => {
    if (!k.startsWith(prefix)) throw new Error(`test helper refused to touch key outside its prefix: ${k}`);
    return k;
  };
  const scan = async (match: string): Promise<string[]> => {
    const r = await raw();
    const out: string[] = [];
    let cursor = "0";
    do {
      const res = await r.scan(cursor, { MATCH: match, COUNT: 500 });
      cursor = res.cursor;
      out.push(...res.keys);
    } while (cursor !== "0");
    return out.sort();
  };

  return {
    redisUrl,
    prefix,
    ...secrets,
    raw,
    /** Absolute key for a prefix-relative name. */
    key: (rel: string) => `${prefix}${rel}`,
    /** All keys currently under this file's prefix. */
    keys: () => scan(`${prefix}*`),
    /** Delete ONLY keys under this file's prefix. */
    async cleanup() {
      if (!client) return;
      const keys = await scan(`${prefix}*`);
      for (let i = 0; i < keys.length; i += 200) await client.unlink(keys.slice(i, i + 200).map(own));
    },
    /** Remove everything under the prefix between tests, keeping the connection. */
    reset: async () => {
      const r = await raw();
      const keys = await scan(`${prefix}*`);
      for (let i = 0; i < keys.length; i += 200) await r.unlink(keys.slice(i, i + 200).map(own));
    },
    /** Deterministic full dump of the prefix (values only; TTLs reduced to "has TTL") for before/after comparisons. */
    async dump(): Promise<Record<string, unknown>> {
      const r = await raw();
      const out: Record<string, unknown> = {};
      for (const k of await scan(`${prefix}*`)) {
        const type = await r.type(k);
        const ttl = (await r.ttl(k)) > 0;
        let v: unknown;
        if (type === "string") v = await r.get(k);
        else if (type === "hash") v = await r.hGetAll(k);
        else if (type === "set") v = (await r.sMembers(k)).sort();
        else if (type === "zset") v = await r.zRangeWithScores(k, 0, -1);
        else if (type === "list") v = await r.lRange(k, 0, -1);
        out[k.slice(prefix.length)] = { type, ttl, v };
      }
      return out;
    },
    async close() {
      if (client?.isOpen) await client.quit().catch(() => client?.destroy());
      client = null;
    },
  };
}
