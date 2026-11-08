import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptBytes, encryptBytes, hashPassword, hmacShort, parseKey, sha256Hex, verifyPassword } from "@/lib/crypto";

const key = () => randomBytes(32);

describe("parseKey", () => {
  it("decodes a 32-byte base64 key", () => {
    const k = randomBytes(32);
    expect(parseKey(k.toString("base64"), "K").equals(k)).toBe(true);
  });
  it("names the variable when missing or the wrong size", () => {
    expect(() => parseKey(undefined, "MY_KEY")).toThrow("MY_KEY is not configured");
    expect(() => parseKey("", "MY_KEY")).toThrow("MY_KEY is not configured");
    expect(() => parseKey(randomBytes(16).toString("base64"), "MY_KEY")).toThrow(/MY_KEY must be 32 bytes/);
    expect(() => parseKey(randomBytes(33).toString("base64"), "MY_KEY")).toThrow(/32 bytes/);
  });
});

describe("AES-256-GCM", () => {
  it("round-trips, with and without AAD", () => {
    const k = key();
    const plain = Buffer.from("héllo wörld 🔐");
    expect(decryptBytes(k, encryptBytes(k, plain)).equals(plain)).toBe(true);
    const aad = Buffer.from("context");
    expect(decryptBytes(k, encryptBytes(k, plain, aad), aad).equals(plain)).toBe(true);
    expect(decryptBytes(k, encryptBytes(k, Buffer.alloc(0))).length).toBe(0);
  });
  it("uses a fresh IV every time and lays out iv|tag|ciphertext", () => {
    const k = key();
    const a = encryptBytes(k, Buffer.from("same"));
    const b = encryptBytes(k, Buffer.from("same"));
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
    expect(a.length).toBe(12 + 16 + 4);
  });
  it("fails when any region is tampered with", () => {
    const k = key();
    const blob = encryptBytes(k, Buffer.from("secret payload"));
    for (const i of [0, 11, 12, 27, 28, blob.length - 1]) {
      const t = Buffer.from(blob);
      t[i] = t[i]! ^ 0x01;
      expect(() => decryptBytes(k, t), `byte ${i}`).toThrow();
    }
    expect(() => decryptBytes(k, blob.subarray(0, blob.length - 1))).toThrow();
  });
  it("fails with the wrong key or the wrong/missing AAD", () => {
    const k = key();
    const aad = Buffer.from("id-1");
    const blob = encryptBytes(k, Buffer.from("x"), aad);
    expect(() => decryptBytes(key(), blob, aad)).toThrow();
    expect(() => decryptBytes(k, blob, Buffer.from("id-2"))).toThrow();
    expect(() => decryptBytes(k, blob)).toThrow();
  });
  it("rejects blobs that are too short", () => {
    expect(() => decryptBytes(key(), Buffer.alloc(27))).toThrow("Ciphertext is too short");
  });
});

describe("hashes", () => {
  it("sha256Hex matches the known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(Buffer.from("abc"))).toBe(sha256Hex("abc"));
  });
  it("hmacShort is deterministic, 22 chars, URL-safe and domain separated", () => {
    const a = hmacShort("secret", "rl", "203.0.113.9");
    expect(a).toBe(hmacShort("secret", "rl", "203.0.113.9"));
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toContain("203.0.113.9");
    expect(hmacShort("secret", "other", "203.0.113.9")).not.toBe(a);
    expect(hmacShort("secret2", "rl", "203.0.113.9")).not.toBe(a);
    expect(hmacShort("secret", "rl", "203.0.113.10")).not.toBe(a);
  });
});

describe("link passwords (scrypt)", () => {
  it("hashes to a self-describing, salted string and verifies", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(h).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("correct horsE", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
    expect(await hashPassword("correct horse")).not.toBe(h); // random salt
  });
  it("normalises Unicode (NFKC) before hashing", async () => {
    const h = await hashPassword("ｐａｓｓｗｏｒｄ１２３");
    expect(await verifyPassword("password123", h)).toBe(true);
  });
  it("returns false (never throws) for malformed stored hashes", async () => {
    const good = await hashPassword("pw-1234");
    const [, n, r, p, salt, hash] = good.split("$");
    for (const bad of [
      "",
      "garbage",
      "bcrypt$12$abc$def$ghi$jkl",
      "scrypt$16384$8$1$onlysalt",
      `scrypt$${n}$${r}$${p}$${salt}$`,
      `scrypt$abc$${r}$${p}$${salt}$${hash}`,
      `scrypt$3$${r}$${p}$${salt}$${hash}`, // N must be a power of two
      `scrypt$1073741824$${r}$${p}$${salt}$${hash}`, // would blow the memory limit
      `scrypt$${n}$${r}$${p}$${salt}$${hash!.slice(0, 10)}`, // truncated hash
    ]) {
      expect(await verifyPassword("pw-1234", bad), bad).toBe(false);
    }
  });
});
