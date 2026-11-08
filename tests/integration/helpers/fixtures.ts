import { encodePayload } from "@/lib/qr/payload";
import { defaultStyle, type CreateInput } from "@/lib/schema";

export const DEST = "https://example.com/landing?a=1&b=%20#frag";

/** A dynamic (redirecting) URL code. Pass `slug: undefined` explicitly via `noSlug` to let the repo pick one. */
export const dynamicUrl = (o: Partial<CreateInput> = {}): CreateInput => ({
  name: "Landing page",
  type: "url",
  mode: "dynamic",
  payload: DEST,
  style: defaultStyle(),
  ...o,
});

export const staticText = (o: Partial<CreateInput> = {}): CreateInput => ({
  name: "Note",
  type: "text",
  mode: "static",
  payload: "hello world",
  fields: { text: "hello world" },
  style: defaultStyle(),
  ...o,
});

export const WIFI_PASSWORD = "hunter2hunter2";
export const wifi = (o: Partial<CreateInput> = {}): CreateInput => {
  const fields = { ssid: "Home Network", password: WIFI_PASSWORD, security: "WPA", hidden: false };
  const enc = encodePayload("wifi", fields);
  if (!enc.ok) throw new Error("fixture");
  return { name: "Home wifi", type: "wifi", mode: "static", payload: enc.payload, fields, style: defaultStyle(), ...o };
};

export const vcard = (o: Partial<CreateInput> = {}): CreateInput => {
  const fields = { firstName: "Ada", lastName: "Lovelace", org: "Analytical Engines", email: "ada@example.com" };
  const enc = encodePayload("vcard", fields);
  if (!enc.ok) throw new Error("fixture");
  return { name: "Ada", type: "vcard", mode: "static", payload: enc.payload, fields, style: defaultStyle(), ...o };
};

const png = (extra = 8) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(extra, 1)]);
export const pngDataUrl = (extra = 8) => `data:image/png;base64,${png(extra).toString("base64")}`;
export const jpegDataUrl = () => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8, 2)]).toString("base64")}`;
export const webpDataUrl = () => `data:image/webp;base64,${Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8, 3)]).toString("base64")}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
