import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    randomBytes,
    scrypt,
    timingSafeEqual
} from "node:crypto";

export function parseKey(b64: string | undefined, name: string): Buffer {
    if (!b64) throw new Error(`${name} is not configured`);
    const k = Buffer.from(b64, "base64");
    if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded (openssl rand -base64 32)`);
    return k;
}

export function encryptBytes(key: Buffer, plain: Buffer, aad?: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    if (aad) c.setAAD(aad);
    const ct = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decryptBytes(key: Buffer, blob: Buffer, aad?: Buffer): Buffer {
    if (blob.length < 28) throw new Error("Ciphertext is too short");
    const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    if (aad) d.setAAD(aad);
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export const hmacShort = (secret: string, label: string, value: string) =>
    createHmac("sha256", `${label}:${secret}`).update(value).digest("base64url").slice(0, 22);

const N = 16384, R = 8, P = 1, KEYLEN = 32;
const scryptAsync = (pw: string, salt: Buffer, n: number, r: number, p: number) =>
    new Promise<Buffer>((res, rej) => scrypt(pw, salt, KEYLEN, {
        N: n,
        r,
        p,
        maxmem: 64 * 1024 * 1024
    }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw: string): Promise<string> {
    const salt = randomBytes(16);
    const dk = await scryptAsync(pw.normalize("NFKC"), salt, N, R, P);
    return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${dk.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
    const [alg, n, r, p, salt, hash] = stored.split("$");
    if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
    const want = Buffer.from(hash, "base64url");
    try {
        const got = await scryptAsync(pw.normalize("NFKC"), Buffer.from(salt, "base64url"), +n, +r, +p);
        return want.length === got.length && timingSafeEqual(want, got);
    } catch {
        return false;
    }
}
