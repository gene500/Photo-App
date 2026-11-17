// Unicode fonts for the itinerary PDF. The built-in PDF fonts only draw WinAnsi text; Noto Sans (SIL OFL, see
// public/fonts/OFL.txt) adds Latin Extended, Vietnamese, Cyrillic and Greek. The files are fetched only when a PDF is
// built, never bundled.

// CJK fallback (only when the trip text has Han, kana or Hangul): one extra file holding Noto Sans Latin/Cyrillic/Greek plus
// the script, regular weight only (jsPDF cannot switch fonts inside a line, so the whole document uses that one family).
// Chinese (GB2312 level 1 hanzi plus JIS X 0208 level 1 kanji and kana, Simplified Chinese glyph forms), Japanese (JIS X 0208
// level 1+2 kanji and kana, Japanese glyph forms) and Korean (KS X 1001 syllables) are included. Arabic,
// Hebrew, Thai and the Indic scripts are NOT: jsPDF has no text shaping or right-to-left support, so they would render
// wrongly, and "?" is better than wrong text.
export type CjkScript = "sc" | "jp" | "kr";
export type PdfFonts = {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
  /** Present only when the trip text needed it and the file loaded. */
  cjk?: { script: CjkScript; regular: ArrayBuffer };
};

const FONT_URLS = { regular: "/fonts/NotoSans-Regular.ttf", bold: "/fonts/NotoSans-Bold.ttf" };
const CJK_FONT_URLS: Record<CjkScript, string> = { sc: "/fonts/NotoSansSC-Regular.ttf", jp: "/fonts/NotoSansJP-Regular.ttf", kr: "/fonts/NotoSansKR-Regular.ttf" };
const CJK_PROBE: Record<CjkScript, number> = { sc: 0x4eac, jp: 0x7dba, kr: 0xd55c }; // 京, 綺 (JIS level 2, so a file without it is not the JP subset), 한: a file without it is the wrong file
const CJK_MAX_BYTES = 6_000_000;

const isHangul = (c: number) => (c >= 0xac00 && c <= 0xd7af) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f);
const isKana = (c: number) => (c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff);
const isHanKana = (c: number) =>
  (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff);

/**
 * The CJK font to try first, or null when the text has neither Han/kana nor Hangul. More Hangul than Han/kana gives Korean;
 * otherwise any kana (which Chinese text does not use) gives Japanese; otherwise Han alone gives Simplified Chinese (Han-only
 * Japanese such as 東京 cannot be told from Chinese). This is only a guess about glyph forms: loadPdfFonts then checks the file's
 * cmap against the actual text and, for kana text, switches to the Chinese file when that draws more of it (see pickCjk).
 */
export function cjkScriptFor(text: string): CjkScript | null {
  let sc = 0;
  let kr = 0;
  let kana = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x1100) continue;
    if (isHangul(c)) kr++;
    else if (isHanKana(c)) {
      sc++;
      if (isKana(c)) kana++;
    }
  }
  if (sc === 0 && kr === 0) return null;
  if (kr > sc) return "kr";
  return kana > 0 ? "jp" : "sc";
}

/** How many code points of `text` (NFC; ASCII, controls, joiners and variation selectors ignored) the font's cmap has no glyph for. */
export function missingCount(text: string, cmap: ReadonlySet<number>): number {
  let n = 0;
  for (const ch of text.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (c < 0xa0 || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) continue;
    if (!cmap.has(c)) n++;
  }
  return n;
}

/**
 * Chooses between the Japanese and Chinese file for kana text by coverage, not by script: the Japanese subset (JIS X 0208) lacks
 * many simplified hanzi the Chinese file draws, while the Chinese file lacks JIS level 2 kanji. Japanese wins when it misses
 * nothing and on ties (Japanese glyph forms); otherwise the file missing fewer of the text's characters wins.
 */
export function pickCjk(text: string, jp: ReadonlySet<number>, sc: ReadonlySet<number>): "jp" | "sc" {
  const jpMissing = missingCount(text, jp);
  return jpMissing === 0 || jpMissing <= missingCount(text, sc) ? "jp" : "sc";
}

/**
 * Fetches the base fonts and, only when `opts.text` has Han/kana/Hangul, the one matching CJK file. Any base failure
 * (offline, 404, truncated file) is null so the PDF still downloads with the built-in fonts; a CJK failure (404, timeout,
 * wrong or oversized file) just leaves `cjk` out, so those characters become "?".
 */
export async function loadPdfFonts(opts: { timeoutMs?: number; cjkTimeoutMs?: number; fetchImpl?: typeof fetch; text?: string } = {}): Promise<PdfFonts | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const get = async (url: string, timeoutMs: number, valid: (buf: ArrayBuffer) => boolean) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Aborting rejects a real fetch; the race also ends the wait if the transport ignores the signal.
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("font timeout"));
      }, timeoutMs);
    });
    try {
      const download = (async () => {
        const res = await fetchImpl(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`font ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!valid(buf)) throw new Error("not a font");
        return buf;
      })();
      download.catch(() => {});
      return await Promise.race([download, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  };
  const base = (buf: ArrayBuffer) => buf.byteLength >= 10000 && parseCmap(buf).size > 0;
  const guess = opts.text ? cjkScriptFor(opts.text) : null;
  type Loaded = { script: CjkScript; regular: ArrayBuffer; cmap: Set<number> };
  const loadCjk = async (script: CjkScript): Promise<Loaded | undefined> => {
    let cmap = new Set<number>();
    try {
      const regular = await get(CJK_FONT_URLS[script], opts.cjkTimeoutMs ?? 30000, (b) => {
        cmap = parseCmap(b);
        return b.byteLength >= 10000 && b.byteLength <= CJK_MAX_BYTES && cmap.has(CJK_PROBE[script]);
      });
      return { script, regular, cmap };
    } catch {
      return undefined;
    }
  };
  // Kana text: load the Japanese file; only when it lacks some of the text's characters (or failed) is the Chinese file also
  // loaded, and the one drawing more of the text is kept. Latin-only text loads nothing, other scripts load just their file.
  const chooseCjk = async (text: string, first: CjkScript): Promise<PdfFonts["cjk"]> => {
    let best = await loadCjk(first);
    if (first === "jp" && (!best || missingCount(text, best.cmap) > 0)) {
      const sc = await loadCjk("sc");
      if (sc && (!best || pickCjk(text, best.cmap, sc.cmap) === "sc")) best = sc;
    }
    return best && { script: best.script, regular: best.regular };
  };
  const cjkPromise: Promise<PdfFonts["cjk"]> = guess && opts.text ? chooseCjk(opts.text, guess) : Promise.resolve(undefined);
  try {
    const [regular, bold, cjk] = await Promise.all([get(FONT_URLS.regular, opts.timeoutMs ?? 15000, base), get(FONT_URLS.bold, opts.timeoutMs ?? 15000, base), cjkPromise]);
    return cjk ? { regular, bold, cjk } : { regular, bold };
  } catch {
    return null;
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
