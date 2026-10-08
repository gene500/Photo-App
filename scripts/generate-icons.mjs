// Generates the PWA icons in public/icons (no dependencies, no network): a beige tile with a dark map pin.
// Run `node scripts/generate-icons.mjs`; the PNGs are committed, so this only needs re-running to change the design.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BEIGE = [0xd9, 0xc7, 0xa3];
const INK = [0x3d, 0x33, 0x20];
const CREAM = [0xf4, 0xf3, 0xf0];

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** `pad` shrinks the pin so a maskable icon keeps it inside the safe zone. */
function png(size, pad) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const cx = size / 2;
  const r = size * (0.24 - pad * 0.05);
  const cy = size * 0.42;
  const tipY = size * (0.78 - pad * 0.08);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // Pin body: a disc whose lower half tapers to a point.
      let inPin = d <= r;
      if (!inPin && y > cy && y < tipY) {
        const half = r * (1 - (y - cy) / (tipY - cy));
        inPin = Math.abs(x + 0.5 - cx) <= half * Math.sqrt(Math.max(0, 1 - ((y - cy) / (tipY - cy)) ** 2) + 0.35);
      }
      const hole = d <= r * 0.42;
      const px = hole ? CREAM : inPin ? INK : BEIGE;
      raw.set(px, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, 0));
writeFileSync("public/icons/icon-512.png", png(512, 0));
writeFileSync("public/icons/icon-maskable-512.png", png(512, 1));
console.log("wrote public/icons/icon-192.png, icon-512.png, icon-maskable-512.png");
