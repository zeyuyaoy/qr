import sharp from "sharp";
import {writeFileSync} from "node:fs";

const glyph = (c) => `
  <rect x="22" y="22" width="28" height="28" rx="6" fill="none" stroke="${c}" stroke-width="7"/><rect x="31" y="31" width="10" height="10" rx="2" fill="${c}"/>
  <rect x="78" y="22" width="28" height="28" rx="6" fill="none" stroke="${c}" stroke-width="7"/><rect x="87" y="31" width="10" height="10" rx="2" fill="${c}"/>
  <rect x="22" y="78" width="28" height="28" rx="6" fill="none" stroke="${c}" stroke-width="7"/><rect x="31" y="87" width="10" height="10" rx="2" fill="${c}"/>
  <rect x="78" y="78" width="12" height="12" rx="3" fill="${c}"/><rect x="94" y="94" width="12" height="12" rx="3" fill="${c}"/><rect x="62" y="62" width="12" height="12" rx="3" fill="${c}"/><rect x="78" y="62" width="12" height="12" rx="3" fill="${c}"/><rect x="62" y="78" width="12" height="12" rx="3" fill="${c}"/>`;
const svg = (pad = 0, radius = 28) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="${radius}" fill="#315546"/><g transform="translate(${64 - 64 * (1 - pad)} ${64 - 64 * (1 - pad)}) scale(${1 - pad})">${glyph("#edf4e9")}</g></svg>`;

writeFileSync("public/icons/icon.svg", svg());
const png = (name, size, markup) => sharp(Buffer.from(markup)).resize(size, size).png().toFile(`public/icons/${name}`);
await png("icon-192.png", 192, svg());
await png("icon-512.png", 512, svg());
await png("apple-touch-icon.png", 180, svg(0, 0));
await png("maskable-512.png", 512, svg(0.22, 0));
console.log("icons written");
