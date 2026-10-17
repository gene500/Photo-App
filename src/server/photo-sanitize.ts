import type { PhotoType } from "@/lib/photo-rules";

/**
 * Upload hygiene without an image library: each format is walked structurally (so truncated or odd files are refused),
 * its size limits are checked, and everything that can carry metadata is dropped (EXIF/GPS, XMP, IPTC, comments, unknown WebP chunks, text
 * and time chunks, trailing bytes). The pixel data is copied untouched, so there is no re-encode and no quality loss.
 */
export const MAX_PHOTO_SIDE = 30000;
export const MAX_PHOTO_PIXELS = 50_000_000;

export type SanitizedPhoto = { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; error: string };

const BAD: SanitizedPhoto = { ok: false, error: "Photo file is damaged or not a valid image" };
const TOO_BIG: SanitizedPhoto = { ok: false, error: `Photo dimensions must be at most ${MAX_PHOTO_SIDE} px per side and ${MAX_PHOTO_PIXELS / 1_000_000} megapixels` };

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le32 = (b: Uint8Array, o: number) => ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const startsWith = (b: Uint8Array, o: number, s: string) => o + s.length <= b.length && ascii(b, o, s.length) === s;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Checks the size limits; null when fine. */
function sizeProblem(width: number, height: number): SanitizedPhoto | null {
  if (!(width > 0) || !(height > 0)) return BAD;
  if (width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE || width * height > MAX_PHOTO_PIXELS) return TOO_BIG;
  return null;
}

export function sanitizePhoto(bytes: Uint8Array, type: PhotoType): SanitizedPhoto {
  try {
    if (type === "image/jpeg") return sanitizeJpeg(bytes);
    if (type === "image/png") return sanitizePng(bytes);
    return sanitizeWebp(bytes);
  } catch {
    return BAD;
  }
}

// ---- JPEG ----

/** The EXIF orientation (2..8) of an APP1 payload, or null. Bounds-checked: any oddity means "none". */
function exifOrientation(p: Uint8Array): number | null {
  if (!startsWith(p, 0, "Exif\0\0") || p.length < 6 + 8) return null;
  const t = p.subarray(6);
  const little = ascii(t, 0, 2) === "II";
  if (!little && ascii(t, 0, 2) !== "MM") return null;
  const u16 = (o: number) => (little ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (little ? le32(t, o) : be32(t, o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112 && u16(e + 2) === 3) {
      const v = u16(e + 8);
      return v >= 2 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** An APP1 segment holding nothing but the orientation, so a rotated phone photo still shows upright. */
function orientationSegment(orientation: number): Uint8Array {
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const len = payload.length + 2;
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 255, ...payload]);
}

/**
 * The parts of a JPEG from its first SOS up to and including the first EOI: entropy-coded data is skipped over (FF00
 * stuffing, FFD0-D7 restarts), later segments are kept unless they are APPn/COM. Null when the file is malformed.
 */
function scanBody(b: Uint8Array, sosAt: number): Uint8Array[] | null {
  const parts: Uint8Array[] = [];
  let runStart = sosAt; // start of the bytes not yet copied
  let pos = sosAt;
  let inSegment = true; // pos sits on a marker segment (the SOS header) rather than entropy data
  for (;;) {
    if (inSegment) {
      if (pos + 4 > b.length || b[pos] !== 0xff) return null;
      const len = be16(b, pos + 2);
      if (len < 2 || pos + 2 + len > b.length) return null;
      pos += 2 + len;
      inSegment = false;
      continue;
    }
    if (pos + 2 > b.length) return null;
    if (b[pos] !== 0xff) {
      pos++;
      continue;
    }
    const m = b[pos + 1];
    if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) pos += 2;
    else if (m === 0xff) pos++;
    else if (m === 0xd9) {
      parts.push(b.subarray(runStart, pos + 2));
      return parts;
    } else if (m === 0x01 || m === 0xd8) return null;
    else {
      // A segment between scans: tables and the next SOS stay, application data and comments go.
      if (pos + 4 > b.length) return null;
      const len = be16(b, pos + 2);
      if (len < 2 || pos + 2 + len > b.length) return null;
      if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) {
        parts.push(b.subarray(runStart, pos));
        runStart = pos + 2 + len;
        pos = runStart;
      } else {
        inSegment = true;
      }
    }
  }
}

function sanitizeJpeg(b: Uint8Array): SanitizedPhoto {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return BAD;
  const head: Uint8Array[] = [b.subarray(0, 2)];
  let orientation: number | null = null;
  let frame: { width: number; height: number } | null = null;
  let exifAt = 1; // index in `head` after the leading JFIF segment
  let pos = 2;
  for (;;) {
    while (b[pos] === 0xff && b[pos + 1] === 0xff) pos++; // fill bytes
    if (pos + 4 > b.length || b[pos] !== 0xff) return BAD;
    const marker = b[pos + 1];
    if (marker === 0xd9 || marker === 0xd8 || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return BAD; // no scan yet
    const len = be16(b, pos + 2);
    const end = pos + 2 + len;
    if (len < 2 || end > b.length) return BAD;
    const payload = b.subarray(pos + 4, end);
    const whole = b.subarray(pos, end);
    if (marker === 0xda) {
      if (!frame) return BAD;
      const problem = sizeProblem(frame.width, frame.height);
      if (problem) return problem;
      // Entropy-coded data follows. Walk it forward to the FIRST end-of-image (so a second JPEG, an MPF image or a
      // motion-photo video appended after it is never kept), copying every scan and its tables but dropping APPn/COM
      // segments met between progressive scans.
      const body = scanBody(b, pos);
      if (!body) return BAD;
      if (orientation) head.splice(exifAt, 0, orientationSegment(orientation));
      return { ok: true, bytes: concat([...head, ...body]), ...frame };
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (payload.length < 6) return BAD;
      frame = { height: be16(payload, 1), width: be16(payload, 3) };
    }
    let keep = true;
    if (marker === 0xe1) {
      orientation ??= exifOrientation(payload);
      keep = false; // EXIF, XMP
    } else if (marker === 0xe0) keep = startsWith(payload, 0, "JFIF\0"); // not the JFXX thumbnail
    else if (marker === 0xe2) keep = startsWith(payload, 0, "ICC_PROFILE\0");
    else if (marker === 0xee) keep = startsWith(payload, 0, "Adobe"); // colour transform flag
    else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) keep = false; // IPTC, other APPn, comments
    if (keep) {
      head.push(whole);
      if (marker === 0xe0 && head.length === 2) exifAt = 2;
    }
    pos = end;
  }
}

// ---- PNG ----

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD", "cICP", "mDCV", "cLLI", "acTL", "fcTL", "fdAT"]);

function sanitizePng(b: Uint8Array): SanitizedPhoto {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let pos = 8;
  let width = 0;
  let height = 0;
  let idat = false;
  let first = true;
  while (pos + 12 <= b.length) {
    const len = be32(b, pos);
    const end = pos + 12 + len;
    const name = ascii(b, pos + 4, 4);
    if (end > b.length || !/^[A-Za-z]{4}$/.test(name)) return BAD;
    if (first) {
      if (name !== "IHDR" || len !== 13) return BAD;
      width = be32(b, pos + 8);
      height = be32(b, pos + 12);
      const problem = sizeProblem(width, height);
      if (problem) return problem;
      first = false;
    } else if (name === "IHDR") return BAD;
    if (name === "IDAT") idat = true;
    if (PNG_KEEP.has(name)) parts.push(b.subarray(pos, end));
    else if (name[0] >= "A" && name[0] <= "Z") return BAD; // unknown critical chunk
    pos = end;
    if (name === "IEND") return idat ? { ok: true, bytes: concat(parts), width, height } : BAD; // trailing bytes dropped
  }
  return BAD;
}

// ---- WebP ----

const WEBP_KEEP = new Set(["VP8 ", "VP8L", "ALPH", "ANIM", "ANMF", "ICCP"]); // VP8X is handled apart

function sanitizeWebp(b: Uint8Array): SanitizedPhoto {
  if (b.length < 20 || !startsWith(b, 0, "RIFF") || !startsWith(b, 8, "WEBP")) return BAD;
  const total = le32(b, 4) + 8;
  if (total > b.length || total < 20) return BAD;
  const parts: Uint8Array[] = [];
  let size: { width: number; height: number } | null = null;
  let image = false;
  let pos = 12;
  while (pos < total) {
    if (pos + 8 > total) return BAD;
    const name = ascii(b, pos, 4);
    const len = le32(b, pos + 4);
    const end = pos + 8 + len + (len & 1);
    if (end > total) return BAD;
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (name === "VP8X") {
      if (len < 10 || parts.length > 0) return BAD;
      size = { width: 1 + (data[4] | (data[5] << 8) | (data[6] << 16)), height: 1 + (data[7] | (data[8] << 8) | (data[9] << 16)) };
      const fixed = Uint8Array.from(b.subarray(pos, end));
      fixed[8] &= ~0x0c; // EXIF and XMP flags
      parts.push(fixed);
    } else if (!WEBP_KEEP.has(name)) {
      // EXIF, XMP and any unknown (vendor) chunk: dropped
    } else {
      if (name === "VP8 ") {
        if (len < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return BAD;
        size ??= { width: (data[6] | (data[7] << 8)) & 0x3fff, height: (data[8] | (data[9] << 8)) & 0x3fff };
        image = true;
      } else if (name === "VP8L") {
        if (len < 5 || data[0] !== 0x2f) return BAD;
        const bits = le32(data, 1);
        size ??= { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        image = true;
      } else if (name === "ANMF") image = true;
      parts.push(b.subarray(pos, end));
    }
    pos = end;
  }
  if (!size || !image) return BAD;
  const problem = sizeProblem(size.width, size.height);
  if (problem) return problem;
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12));
  out.set(body, 12);
  const riffSize = out.length - 8;
  out[4] = riffSize & 255;
  out[5] = (riffSize >>> 8) & 255;
  out[6] = (riffSize >>> 16) & 255;
  out[7] = (riffSize >>> 24) & 255;
  return { ok: true, bytes: out, ...size };
}
