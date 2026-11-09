const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomString(alphabet: string, length: number): string {
    const limit = 256 - (256 % alphabet.length);
    let out = "";
    while (out.length < length) {
        const buf = new Uint8Array(length * 2);
        globalThis.crypto.getRandomValues(buf);
        for (const b of buf) {
            if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
        }
    }
    return out;
}

export const newId = () => randomString(ID_ALPHABET, 14);
export const newSlug = (length = 7) => randomString(SLUG_ALPHABET, length);
export const newOpId = () => randomString(ID_ALPHABET, 16);

export function slugify(input: string): string {
    return input
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
}
