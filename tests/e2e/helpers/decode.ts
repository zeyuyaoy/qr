import jsQR from "jsqr";
import sharp from "sharp";

/** Independent decode of an exported QR image (PNG/JPEG/WebP/SVG) using jsQR — a different code path than the encoder. */
export async function decodeQr(buf: Buffer): Promise<string | null> {
  // SVG is rasterised at a generous size; sharp handles the other formats natively.
  const img = sharp(buf, { density: 300 }).flatten({ background: "#ffffff" }).ensureAlpha();
  const { data, info } = await img.resize({ width: 800, height: 800, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const res = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: "attemptBoth" });
  return res?.data ?? null;
}
