import {backupConfigured, freshness, readStatus} from "./backup/run";
import {listRemote} from "./backup/github";
import {configReport} from "./env";
import {getMeta, health} from "./redis/repo";
import {sealingAvailable} from "./seal";

export async function buildStatus() {
    const config = configReport();
    const redis = await health();
    let initialized: boolean | null = null;
    let meta = null;
    let recovery: {
        needed: boolean;
        backup?: { name: string; createdAt: string } | null;
        backupError?: string
    } = {needed: false};
    let backup: {
        configured: boolean;
        freshness: ReturnType<typeof freshness>;
        lastRun: unknown
    } = {configured: backupConfigured(), freshness: freshness(null), lastRun: null};
    if (redis.ok) {
        meta = await getMeta();
        initialized = Boolean(meta);
        const st = await readStatus();
        backup = {
            configured: backupConfigured(),
            freshness: freshness(st.lastSuccessAt),
            lastRun: st.history[0] ?? null
        };
        if (!initialized) {
            recovery = {needed: true, backup: null};
            if (backupConfigured()) {
                try {
                    const latest = (await listRemote())[0];
                    recovery.backup = latest ? {name: latest.name, createdAt: latest.createdAt} : null;
                } catch (e) {
                    recovery.backupError = e instanceof Error ? e.message : "Could not list backups";
                }
            }
        }
    }
    const usedPct = redis.ok && redis.used && redis.max ? redis.used / redis.max : null;
    return {
        config,
        redis,
        initialized,
        meta,
        recovery,
        backup,
        sealing: sealingAvailable(),
        security: {
            redisTls: redis.tls,
            warning: redis.tls ? null : "The connection to Redis is not encrypted (Redis Cloud Free has no TLS). Link passwords are hashed and Wi-Fi/contact codes are sealed, but destinations and metadata cross the network in clear text.",
        },
        storage: {
            usedBytes: redis.ok ? redis.used : null,
            maxBytes: redis.ok ? redis.max : null,
            warn: usedPct !== null && usedPct > 0.8,
            usedPct
        },
    };
}
