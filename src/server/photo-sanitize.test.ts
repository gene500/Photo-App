import { describe, expect, it } from "vitest";
import { MAX_PHOTO_PIXELS, MAX_PHOTO_SIDE, sanitizePhoto } from "./photo-sanitize";

const u8 = (...parts: (number[] | Uint8Array | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : [...p])));
const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => be32(n).reverse();
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

// ---- JPEG builders ----
const seg = (marker: number, payload: number[] | Uint8Array) => u8([0xff, marker], be16(payload.length + 2), payload);
function exifApp1(orientation: number | null, gps = true): Uint8Array {
  // Big-endian TIFF with IFD0 holding Orientation (optional) and a GPS pointer (optional).
  const entries: number[][] = [];
  if (orientation !== null) entries.push([...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0]);
  if (gps) entries.push([...be16(0x8825), ...be16(4), ...be32(1), ...be32(0x40)]);
  const tiff = u8("MM", be16(42), be32(8), be16(entries.length), ...entries, be32(0), new Array(0x60).fill(0x41));
  return seg(0xe1, u8("Exif\0\0", tiff));
}
const sof = (w: number, h: number) => seg(0xc0, u8([8], be16(h), be16(w), [1, 1, 0x11, 0]));
const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
function jpeg(opts: { w?: number; h?: number; extra?: Uint8Array[]; tail?: number[] } = {}) {
  return u8([0xff, 0xd8], seg(0xe0, u8("JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0])), ...(opts.extra ?? []), sof(opts.w ?? 40, opts.h ?? 30),
    sos, [0x12, 0x34, 0xff, 0x00, 0x56], [0xff, 0xd9], opts.tail ?? []);
}

describe("sanitizePhoto: JPEG", () => {
  it("removes EXIF/GPS, XMP, IPTC and comments but keeps the picture data, JFIF and ICC", () => {
    const icc = seg(0xe2, u8("ICC_PROFILE\0", [1, 1, 9, 9]));
    const input = jpeg({ extra: [exifApp1(null), seg(0xe1, u8("http://ns.adobe.com/xap/1.0/\0<x/>")), seg(0xed, u8("Photoshop 3.0\0")), seg(0xfe, u8("secret comment")), icc] });
    const r = sanitizePhoto(input, "image/jpeg");
    if (!r.ok) throw new Error(r.error);
    const out = text(r.bytes);
    expect(out).not.toContain("Exif");
    expect(out).not.toContain("adobe");
    expect(out).not.toContain("Photoshop");
    expect(out).not.toContain("secret");
    expect(out).toContain("JFIF");
    expect(out).toContain("ICC_PROFILE");
    expect(r.width).toBe(40);
    expect(r.height).toBe(30);
    expect([...r.bytes.slice(-7)]).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
  });
  it("keeps only the orientation of the EXIF block so the photo still shows upright", () => {
    const r = sanitizePhoto(jpeg({ extra: [exifApp1(6)] }), "image/jpeg");
    if (!r.ok) throw new Error(r.error);
    const out = text(r.bytes);
    expect(out).toContain("Exif");
    expect(out).not.toContain("AAAA"); // the padding and GPS pointer are gone
    expect(r.bytes.length).toBeLessThan(jpeg({ extra: [exifApp1(6)] }).length);
    // Re-sanitising the output is stable and still reports orientation 6.
    const again = sanitizePhoto(r.bytes, "image/jpeg");
    if (!again.ok) throw new Error(again.error);
    expect(Buffer.from(again.bytes).equals(Buffer.from(r.bytes))).toBe(true);
  });
  it("drops trailing bytes after the end-of-image marker", () => {
    const r = sanitizePhoto(jpeg({ tail: [...u8("GPS=1,2")] }), "image/jpeg");
    if (!r.ok) throw new Error(r.error);
    expect(text(r.bytes)).not.toContain("GPS");
    expect(r.bytes[r.bytes.length - 1]).toBe(0xd9);
  });
  it("rejects truncated, frame-less and oversized files", () => {
    expect(sanitizePhoto(jpeg().slice(0, 30), "image/jpeg").ok).toBe(false);
    expect(sanitizePhoto(u8([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg").ok).toBe(false);
    expect(sanitizePhoto(u8([0xff, 0xd8, 0xff]), "image/jpeg").ok).toBe(false);
    expect(sanitizePhoto(jpeg({ w: MAX_PHOTO_SIDE + 1, h: 10 }), "image/jpeg").ok).toBe(false);
    expect(sanitizePhoto(jpeg({ w: 9000, h: 9000 }), "image/jpeg").ok).toBe(false);
    expect(9000 * 9000).toBeGreaterThan(MAX_PHOTO_PIXELS);
    expect(sanitizePhoto(jpeg({ w: 0, h: 5 }), "image/jpeg").ok).toBe(false);
  });
});

// ---- PNG builders ----
const chunk = (type: string, data: number[] = []) => u8(be32(data.length), type, data, [0, 0, 0, 0]);
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ihdr = (w: number, h: number) => chunk("IHDR", [...be32(w), ...be32(h), 8, 2, 0, 0, 0]);
function png(opts: { w?: number; h?: number; extra?: Uint8Array[]; tail?: number[]; noIend?: boolean } = {}) {
  return u8(PNG_SIG, ihdr(opts.w ?? 20, opts.h ?? 10), ...(opts.extra ?? []), chunk("IDAT", [1, 2, 3]), opts.noIend ? [] : chunk("IEND"), opts.tail ?? []);
}

describe("sanitizePhoto: PNG", () => {
  it("removes eXIf, text and time chunks and trailing bytes, keeps image chunks", () => {
    const r = sanitizePhoto(png({ extra: [chunk("eXIf", [...u8("GPSDATA")]), chunk("tEXt", [...u8("Author\0me")]), chunk("iTXt"), chunk("zTXt"), chunk("tIME", [0, 0, 0, 0, 0, 0, 0]), chunk("gAMA", [0, 0, 1, 1])], tail: [...u8("TRAILING")] }), "image/png");
    if (!r.ok) throw new Error(r.error);
    const out = text(r.bytes);
    for (const bad of ["eXIf", "tEXt", "iTXt", "zTXt", "tIME", "GPSDATA", "TRAILING"]) expect(out).not.toContain(bad);
    for (const good of ["IHDR", "gAMA", "IDAT", "IEND"]) expect(out).toContain(good);
    expect(r.width).toBe(20);
    expect(r.height).toBe(10);
  });
  it("rejects a missing IEND, a bad chunk length, no IDAT, and oversized dimensions", () => {
    expect(sanitizePhoto(png({ noIend: true }), "image/png").ok).toBe(false);
    const bad = png(); // make the IDAT length run past the end
    bad[8 + 25 + 3] = 0xff;
    expect(sanitizePhoto(bad, "image/png").ok).toBe(false);
    expect(sanitizePhoto(u8(PNG_SIG, ihdr(5, 5), chunk("IEND")), "image/png").ok).toBe(false);
    expect(sanitizePhoto(png({ w: MAX_PHOTO_SIDE + 1, h: 1 }), "image/png").ok).toBe(false);
    expect(sanitizePhoto(png({ w: 9000, h: 9000 }), "image/png").ok).toBe(false);
    expect(sanitizePhoto(png({ w: 0, h: 1 }), "image/png").ok).toBe(false);
  });
});

// ---- WebP builders ----
const wchunk = (type: string, data: number[]) => u8(type, le32(data.length), data, data.length % 2 ? [0] : []);
const riff = (...chunks: Uint8Array[]) => {
  const body = u8("WEBP", ...chunks);
  return u8("RIFF", le32(body.length), body);
};
const vp8 = (w: number, h: number) => wchunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8, 0, 0]);
const vp8x = (flags: number, w: number, h: number) =>
  wchunk("VP8X", [flags, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, (w - 1) >> 16, (h - 1) & 255, ((h - 1) >> 8) & 255, (h - 1) >> 16]);

describe("sanitizePhoto: WebP", () => {
  it("removes EXIF and XMP chunks and their VP8X flags, and fixes the RIFF size", () => {
    const input = riff(vp8x(0x08 | 0x04 | 0x20, 64, 48), wchunk("ICCP", [1, 2, 3]), wchunk("EXIF", [...u8("GPSDATA!")]), wchunk("XMP ", [...u8("xmpdata")]), vp8(64, 48));
    const r = sanitizePhoto(input, "image/webp");
    if (!r.ok) throw new Error(r.error);
    const out = text(r.bytes);
    expect(out).not.toContain("EXIF");
    expect(out).not.toContain("XMP ");
    expect(out).toContain("ICCP");
    expect(r.bytes[20]).toBe(0x20); // VP8X flags: only ICC left
    const size = r.bytes[4] | (r.bytes[5] << 8) | (r.bytes[6] << 16) | (r.bytes[7] << 24);
    expect(size).toBe(r.bytes.length - 8);
    expect(r.width).toBe(64);
    expect(r.height).toBe(48);
  });
  it("reads the size of a simple lossy file and a lossless file", () => {
    const lossy = sanitizePhoto(riff(vp8(100, 50)), "image/webp");
    expect(lossy.ok && [lossy.width, lossy.height]).toEqual([100, 50]);
    const w = 33 - 1, h = 22 - 1;
    const bits = w | (h << 14);
    const lossless = sanitizePhoto(riff(wchunk("VP8L", [0x2f, ...le32(bits).slice(0, 4), 0])), "image/webp");
    expect(lossless.ok && [lossless.width, lossless.height]).toEqual([33, 22]);
  });
  it("rejects a bad RIFF size, a chunk running past the end, no image chunk and oversized dimensions", () => {
    const good = riff(vp8(10, 10));
    const bad = Uint8Array.from(good);
    bad[4] = 0xff;
    expect(sanitizePhoto(bad, "image/webp").ok).toBe(false);
    expect(sanitizePhoto(good.slice(0, good.length - 4), "image/webp").ok).toBe(false);
    expect(sanitizePhoto(riff(wchunk("EXIF", [1, 2])), "image/webp").ok).toBe(false);
    expect(sanitizePhoto(riff(vp8x(0, MAX_PHOTO_SIDE + 1, 1), vp8(10, 10)), "image/webp").ok).toBe(false);
    expect(sanitizePhoto(riff(vp8(0, 5)), "image/webp").ok).toBe(false);
  });
});
