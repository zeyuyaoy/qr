import { env } from "./env";
import { decryptBytes, encryptBytes, parseKey } from "./crypto";
import { SENSITIVE_TYPES, type QrRecord } from "./schema";

/**
 * Redis Cloud Free has no TLS, so anything that crosses the wire is readable by a network observer.
 * Wi-Fi passwords and contact cards are therefore sealed (AES-256-GCM, DATA_ENCRYPTION_KEY) before
 * they leave the app. Link-resolution fields (slug, status, tags …) stay in the clear — they must
 * be readable by Lua and are not secret.
 */
export const needsSealing = (type: QrRecord["type"]) => SENSITIVE_TYPES.includes(type);
export const sealingAvailable = () => Boolean(env.dataKey());

type Secret = Pick<QrRecord, "payload" | "fields">;
export type Stored = Omit<QrRecord, "payload" | "fields"> & { payload: string; fields: Record<string, unknown>; sealed?: string };

export class SealError extends Error {}

export function seal(r: QrRecord): Stored {
  if (!needsSealing(r.type)) return r;
  if (!sealingAvailable()) throw new SealError("DATA_ENCRYPTION_KEY is required to store Wi-Fi and contact codes");
  const key = parseKey(env.dataKey(), "DATA_ENCRYPTION_KEY");
  const body: Secret = { payload: r.payload, fields: r.fields };
  const blob = encryptBytes(key, Buffer.from(JSON.stringify(body)), Buffer.from(r.id));
  return { ...r, payload: "sealed", fields: {}, sealed: blob.toString("base64") };
}

export function open(s: Stored): QrRecord {
  if (!s.sealed) return s;
  try {
    const key = parseKey(env.dataKey(), "DATA_ENCRYPTION_KEY"); // a missing/invalid key is a SealError too (NOT_CONFIGURED, not a 500)
    const body = JSON.parse(decryptBytes(key, Buffer.from(s.sealed, "base64"), Buffer.from(s.id)).toString()) as Secret;
    const { sealed: _drop, ...rest } = s;
    void _drop;
    return { ...rest, payload: body.payload, fields: body.fields };
  } catch {
    throw new SealError("Could not decrypt this record (wrong or missing DATA_ENCRYPTION_KEY)");
  }
}
