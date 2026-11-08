/** QR decoding helpers. Native BarcodeDetector when present, jsQR (lazy chunk) otherwise. Pure client, works offline. */
type NativeDetector = { detect(src: ImageBitmapSource): Promise<{ rawValue: string }[]> };
type NativeCtor = { new (o: { formats: string[] }): NativeDetector; getSupportedFormats?: () => Promise<string[]> };

const tick = () => new Promise<void>((r) => setTimeout(r));
/** Native detectors can hang on some platforms (e.g. headless Chromium); never wait on them for long. */
const within = <T,>(p: Promise<T>, ms = 2000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("detector timeout")), ms))]);

async function nativeDetector(): Promise<NativeDetector | null> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    if (Ctor.getSupportedFormats && !(await within(Ctor.getSupportedFormats())).includes("qr_code")) return null;
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

async function loadJsQr() {
  return (await import("jsqr")).default;
}

/** Draw `src` scaled so its longest side is at most `max`, and return the pixels. */
function pixels(canvas: HTMLCanvasElement, src: CanvasImageSource, w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Returns a function that decodes one camera frame, or null when nothing is found. */
export async function createVideoDecoder(): Promise<(v: HTMLVideoElement) => Promise<string | null>> {
  let native = await nativeDetector();
  const canvas = document.createElement("canvas");
  let jsQR: Awaited<ReturnType<typeof loadJsQr>> | null = null;
  return async (v) => {
    if (native) {
      try {
        return (await within(native.detect(v)))[0]?.rawValue || null;
      } catch {
        native = null; // runtime failure: stay on jsQR from now on
      }
    }
    jsQR ??= await loadJsQr();
    const img = pixels(canvas, v, v.videoWidth, v.videoHeight, 640);
    return img ? (jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null) : null;
  };
}

async function toBitmap(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  if ("createImageBitmap" in globalThis) {
    try {
      const b = await createImageBitmap(file);
      return { src: b, w: b.width, h: b.height, close: () => b.close() };
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode a still image. Tries native detection, then jsQR at several sizes, with and without colour inversion. */
export async function decodeImageFile(file: Blob): Promise<string | null> {
  const bmp = await toBitmap(file);
  try {
    const native = await nativeDetector();
    if (native && "close" in bmp.src) {
      try {
        const hit = (await within(native.detect(bmp.src as ImageBitmap)))[0]?.rawValue;
        if (hit) return hit;
      } catch {
        /* continue with jsQR */
      }
    }
    const jsQR = await loadJsQr();
    const canvas = document.createElement("canvas");
    // Downscaling often helps with large photos (moire, noise) and keeps decoding fast.
    for (const max of [1600, 1000, 600, 320]) {
      const img = pixels(canvas, bmp.src, bmp.w, bmp.h, max);
      if (!img) continue;
      const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
      if (hit?.data) return hit.data;
      await tick(); // keep the UI responsive between attempts
    }
    return null;
  } finally {
    bmp.close();
  }
}

export type UrlInfo = { url: string; host: string; warnings: string[] };

/** Only http(s) URLs are openable. Returns null for everything else (javascript:, data:, intent:, plain text …). */
export function analyzeUrl(raw: string): UrlInfo | null {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t) || /\s/.test(t)) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const warnings: string[] = [];
  const host = u.hostname;
  if (host.split(".").some((l) => l.toLowerCase().startsWith("xn--"))) warnings.push("The address uses punycode (xn--), which is how look-alike characters are encoded. It may imitate a different, trusted site.");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) warnings.push("The address is a raw IP address instead of a name, which legitimate services rarely use.");
  if (u.username || u.password) warnings.push("The address contains a username or password part before the host, a common trick to disguise the real destination.");
  if (u.protocol === "http:") warnings.push("The connection is not encrypted (http).");
  return { url: u.href, host, warnings };
}
