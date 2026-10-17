// Unicode fonts for the itinerary PDF. The built-in PDF fonts only draw WinAnsi text; Noto Sans (SIL OFL, see
// public/fonts/OFL.txt) adds Latin Extended, Vietnamese, Cyrillic and Greek. The files are fetched only when a PDF is
// built, never bundled.

export type PdfFonts = { regular: ArrayBuffer; bold: ArrayBuffer };

const FONT_URLS = { regular: "/fonts/NotoSans-Regular.ttf", bold: "/fonts/NotoSans-Bold.ttf" };

/** Fetches both font files; any failure (offline, 404, truncated file) is null so the PDF still downloads with the built-in fonts. */
export async function loadPdfFonts(opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<PdfFonts | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  const get = async (url: string) => {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`font ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 10000 || parseCmap(buf).size === 0) throw new Error("not a font");
    return buf;
  };
  try {
    const [regular, bold] = await Promise.all([get(FONT_URLS.regular), get(FONT_URLS.bold)]);
    return { regular, bold };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The set of code points a TrueType font has glyphs for (cmap formats 4 and 12, which cover the BMP and beyond); empty if unreadable. */
export function parseCmap(buf: ArrayBuffer): Set<number> {
  const out = new Set<number>();
  try {
    const v = new DataView(buf);
    const tables = v.getUint16(4);
    let cmap = -1;
    for (let i = 0; i < tables; i++) {
      const rec = 12 + i * 16;
      if (v.getUint32(rec) === 0x636d6170) cmap = v.getUint32(rec + 8); // "cmap"
    }
    if (cmap < 0) return out;
    const subtables = v.getUint16(cmap + 2);
    for (let i = 0; i < subtables; i++) {
      const platform = v.getUint16(cmap + 4 + i * 8);
      const encoding = v.getUint16(cmap + 4 + i * 8 + 2);
      // Unicode (platform 0) or Windows Unicode (3/1 BMP, 3/10 full).
      if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
      const t = cmap + v.getUint32(cmap + 4 + i * 8 + 4);
      const format = v.getUint16(t);
      if (format === 4) {
        const segs = v.getUint16(t + 6) / 2;
        const ends = t + 14;
        const starts = ends + segs * 2 + 2;
        const deltas = starts + segs * 2;
        const rangeOffsets = deltas + segs * 2;
        for (let s = 0; s < segs; s++) {
          const end = v.getUint16(ends + s * 2);
          const start = v.getUint16(starts + s * 2);
          const delta = v.getUint16(deltas + s * 2);
          const ro = v.getUint16(rangeOffsets + s * 2);
          for (let c = start; c <= end && c !== 0xffff; c++) {
            let glyph = 0;
            if (ro === 0) glyph = (c + delta) & 0xffff;
            else {
              const g = v.getUint16(rangeOffsets + s * 2 + ro + (c - start) * 2);
              glyph = g === 0 ? 0 : (g + delta) & 0xffff;
            }
            if (glyph !== 0) out.add(c);
          }
        }
      } else if (format === 12) {
        const groups = v.getUint32(t + 12);
        for (let g = 0; g < groups; g++) {
          const start = v.getUint32(t + 16 + g * 12);
          const end = v.getUint32(t + 16 + g * 12 + 4);
          const glyph = v.getUint32(t + 16 + g * 12 + 8);
          if (glyph === 0) continue;
          for (let c = start; c <= end; c++) out.add(c);
        }
      }
    }
  } catch {
    out.clear();
  }
  return out;
}

/**
 * Text the font can draw: NFC-normalised, tab as a space, newlines kept, other control characters dropped, and each run of
 * characters the font lacks (CJK, Arabic, emoji, ...) replaced by one `?` so the reader sees something was omitted.
 */
export function pdfText(text: string, supports: (codePoint: number) => boolean): string {
  let out = "";
  let inGap = false;
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n") out += ch;
    else if (ch === "\t") out += " ";
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    else if (supports(code)) out += ch;
    else {
      // Invisible joiners and variation selectors ride along with the run they belong to.
      if (!inGap && !(code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f))) out += "?";
      inGap = true;
      continue;
    }
    inGap = false;
  }
  return out;
}
