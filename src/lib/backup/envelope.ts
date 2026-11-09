import {gunzipSync, gzipSync} from "node:zlib";
import {decryptBytes, encryptBytes, parseKey, sha256Hex} from "../crypto";

export const ENVELOPE_FORMAT = "qr-studio-backup";

export type Envelope = {
    format: typeof ENVELOPE_FORMAT;
    version: 1;
    alg: "A256GCM+gzip";
    createdAt: string;
    schemaVersion: number;
    recordCount: number;
    contentSha256: string;
    data: string;
};

export class BackupFormatError extends Error {
}

const aad = (e: Omit<Envelope, "data" | "alg" | "format">) =>
    Buffer.from(`${ENVELOPE_FORMAT}|${e.version}|${e.createdAt}|${e.schemaVersion}|${e.recordCount}|${e.contentSha256}`);

export function seal(plaintext: string, meta: {
    createdAt: string;
    schemaVersion: number;
    recordCount: number;
    contentSha256: string
}, keyB64: string | undefined): Envelope {
    const key = parseKey(keyB64, "BACKUP_ENCRYPTION_KEY");
    const head = {version: 1 as const, ...meta};
    const blob = encryptBytes(key, gzipSync(Buffer.from(plaintext)), aad(head));
    return {format: ENVELOPE_FORMAT, alg: "A256GCM+gzip", ...head, data: blob.toString("base64")};
}

export function parseEnvelope(text: string): Envelope {
    let e: Envelope;
    try {
        e = JSON.parse(text) as Envelope;
    } catch {
        throw new BackupFormatError("Backup file is not valid JSON");
    }
    if (e?.format !== ENVELOPE_FORMAT || e.version !== 1 || e.alg !== "A256GCM+gzip" || typeof e.data !== "string") {
        throw new BackupFormatError("Not a QR Studio backup (or an unsupported version)");
    }
    return e;
}

export function open(e: Envelope, keyB64: string | undefined): string {
    const key = parseKey(keyB64, "BACKUP_ENCRYPTION_KEY");
    let plain: string;
    try {
        plain = gunzipSync(decryptBytes(key, Buffer.from(e.data, "base64"), aad(e)), {maxOutputLength: 40 * 1024 * 1024}).toString("utf8");
    } catch {
        throw new BackupFormatError("Could not decrypt: wrong BACKUP_ENCRYPTION_KEY or the file was modified/corrupted");
    }
    if (sha256Hex(plain) !== e.contentSha256) throw new BackupFormatError("Checksum mismatch: backup contents are corrupted");
    return plain;
}
