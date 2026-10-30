// Draws the itinerary as an A4 PDF with jsPDF (loaded on demand, never at module load).

import { downsampleRoute } from "./downsample";
import { fanOffsets } from "./marker-fan";
import { parseCmap, pdfText, type PdfFonts } from "./pdf-fonts";
import { PDF_BORDER, PDF_RULE, PDF_THEME, hexToRgb, markerTextColor, safeStopColor, type Rgb } from "./pdf-theme";
import type { ItineraryInput } from "./itinerary";
import { STATIC_MAP_HEIGHT, STATIC_MAP_WIDTH } from "./static-map";
import type { LngLat } from "./types";

export type PdfMap = { kind: "image"; dataUrl: string } | { kind: "fallback" };

// Windows-1252 punctuation above U+00FF; jsPDF encodes these to their WinAnsi bytes, so the standard fonts draw them.
const WIN_ANSI_EXTRA = new Set([..."\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2122"]);

/** Standard PDF fonts draw Latin-1 plus a few Windows-1252 marks: each run of other characters becomes one `?`, tabs a space, other control characters (except newline) go. */
export function pdfSafe(text: string): string {
  return pdfText(text, (code) => code <= 0xff || WIN_ANSI_EXTRA.has(String.fromCodePoint(code)));
}

const UNICODE_FAMILY = "NotoSans";
const CJK_FAMILY = "NotoSansCJK";

/** Every string the PDF draws, for choosing fonts before the PDF is built. */
export function itineraryText(input: ItineraryInput): string {
  const parts = [input.tripName, input.dateLine, input.startLine, input.routeLine, input.note];
  for (const s of input.stops) parts.push(s.name, s.arrival, s.bestLight, s.weather, s.notes);
  return parts.filter((t): t is string => typeof t === "string").join("\n");
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const MARGIN = 40;
const MAP_RADIUS = 8;
const MAP_ASPECT = STATIC_MAP_HEIGHT / STATIC_MAP_WIDTH;
const FOOTER_SPACE = 30;
const MARKER_R = 9;
const MARKER_GAP = 10;
const STOP_INDENT = MARKER_R * 2 + MARKER_GAP;

const fillRgb = (doc: Doc, c: Rgb | string) => { const [r, g, b] = typeof c === "string" ? hexToRgb(c) : c; doc.setFillColor(r, g, b); };
const drawRgb = (doc: Doc, c: Rgb | string) => { const [r, g, b] = typeof c === "string" ? hexToRgb(c) : c; doc.setDrawColor(r, g, b); };
const textRgb = (doc: Doc, c: Rgb | string) => { const [r, g, b] = typeof c === "string" ? hexToRgb(c) : c; doc.setTextColor(r, g, b); };

type Doc = InstanceType<Awaited<typeof import("jspdf")>["jsPDF"]>;

/** Shift longitudes by multiples of 360 so each step from the previous point is at most 180 degrees (antimeridian). */
function unwrapLongitudes(points: LngLat[]): LngLat[] {
  let shift = 0;
  return points.map((p, i) => {
    if (i > 0) {
      const prev = points[i - 1][0];
      if (p[0] - prev > 180) shift -= 360;
      else if (p[0] - prev < -180) shift += 360;
    }
    return [p[0] + shift, p[1]];
  });
}

function drawFallbackMap(doc: Doc, family: string, x: number, y: number, w: number, h: number, geometry: LngLat[], stops: { lat: number; lng: number }[], colors: string[]) {
  fillRgb(doc, PDF_THEME.backdrop);
  drawRgb(doc, PDF_BORDER);
  doc.setLineWidth(1);
  doc.roundedRect(x, y, w, h, MAP_RADIUS, MAP_RADIUS, "FD");
  const finite = (p: LngLat) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const usable = geometry.filter(finite);
  const rawStops = stops.map((s): LngLat => [s.lng, s.lat]).filter(finite);
  const rawPts: LngLat[] = usable.length >= 2 ? downsampleRoute(usable, 1000) : rawStops;
  const pts = unwrapLongitudes(rawPts);
  const refLng = pts.length ? pts.reduce((a, p) => a + p[0], 0) / pts.length : 0;
  const stopPts = rawStops.map((p): LngLat => [p[0] + 360 * Math.round((refLng - p[0]) / 360), p[1]]);
  const all = [...pts, ...stopPts];
  if (all.length === 0) return;
  const meanLat = all.reduce((a, p) => a + p[1], 0) / all.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const px = (p: LngLat) => p[0] * k;
  const xs = all.map(px);
  const ys = all.map((p) => p[1]);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of xs) {
    if (v < minX) minX = v;
    if (v > maxX) maxX = v;
  }
  for (const v of ys) {
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const degenerate = spanX < 1e-6 && spanY < 1e-6;
  const m = 28;
  const scale = degenerate ? 0 : Math.min((w - 2 * m) / Math.max(spanX, 1e-9), (h - 2 * m) / Math.max(spanY, 1e-9));
  const offX = x + (w - spanX * scale) / 2;
  const offY = y + (h - spanY * scale) / 2;
  const at = (p: LngLat): [number, number] => [offX + (px(p) - minX) * scale, offY + (spanY - (p[1] - minY)) * scale];
  if (pts.length >= 2) {
    const a = pts.map(at);
    const deltas: [number, number][] = [];
    for (let i = 1; i < a.length; i++) deltas.push([a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]]);
    drawRgb(doc, PDF_THEME.route);
    doc.setLineWidth(2.5);
    doc.lines(deltas, a[0][0], a[0][1], [1, 1], "S", false);
  }
  doc.setFontSize(8);
  // Display-only: numbered circles (16 pt wide) that would overlap are fanned around their shared spot so every number stays legible.
  const spots = stopPts.map((p, i) => { const [x, y] = at(p); return { id: String(i), x, y }; });
  const fan = fanOffsets(spots, 18);
  stopPts.forEach((_, i) => {
    const o = fan.get(String(i));
    const cx = spots[i].x + (o?.dx ?? 0);
    const cy = spots[i].y + (o?.dy ?? 0);
    const fill = safeStopColor(colors[i]);
    fillRgb(doc, PDF_THEME.white);
    doc.circle(cx, cy, 9.5, "F");
    fillRgb(doc, fill);
    doc.circle(cx, cy, 8, "F");
    textRgb(doc, markerTextColor(fill));
    doc.setFont(family, "bold");
    doc.text(String(i + 1), cx, cy + 2.8, { align: "center" });
  });
  textRgb(doc, PDF_THEME.foreground);
  doc.setLineWidth(1);
}

export async function renderItineraryPdf(
  input: ItineraryInput,
  map: PdfMap,
  geometry: LngLat[],
  stops: { lat: number; lng: number }[],
  fonts: PdfFonts | null = null,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - 2 * MARGIN;
  const limit = pageH - MARGIN - FOOTER_SPACE;
  let y = MARGIN;

  // Every page gets the app's paper colour first, so later drawing lands on top of it.
  const paintPage = () => {
    fillRgb(doc, PDF_THEME.paper);
    doc.rect(0, 0, pageW, pageH, "F");
  };
  paintPage();
  const colors = input.stops.map((s) => safeStopColor(s.color));

  // With the Unicode font only its own gaps become "?"; without it (offline, failed fetch) the WinAnsi rule applies.
  let family = "helvetica";
  let safe = pdfSafe;
  // jsPDF swallows a font parse error inside addFont (a truncated file registers a broken family and a later measure throws),
  // so after adding, check the family is registered with usable metrics; a failure throws into the caller's try/catch.
  const verifyFamily = (fam: string, sample: string) => {
    const styles = (doc.getFontList() as Record<string, string[]>)[fam];
    if (!styles || !styles.includes("normal") || !styles.includes("bold")) throw new Error("font not registered");
    for (const style of ["normal", "bold"]) {
      doc.setFont(fam, style);
      const width = doc.getTextWidth(sample);
      if (!Number.isFinite(width) || width <= 0) throw new Error("font has no metrics");
    }
    doc.setFont("helvetica", "normal");
  };
  const applyCjk = (cjk: NonNullable<PdfFonts["cjk"]>): boolean => {
    try {
      // One family with Latin + the CJK script; regular weight stands in for bold (jsPDF cannot mix fonts in a line).
      const cjkSupported = parseCmap(cjk.regular);
      if (cjkSupported.size === 0) return false;
      doc.addFileToVFS("NotoSansCJK-Regular.ttf", toBase64(cjk.regular));
      doc.addFont("NotoSansCJK-Regular.ttf", CJK_FAMILY, "normal");
      doc.addFont("NotoSansCJK-Regular.ttf", CJK_FAMILY, "bold");
      verifyFamily(CJK_FAMILY, "A\u4eac");
      family = CJK_FAMILY;
      safe = (t) => pdfText(t, (c) => cjkSupported.has(c));
      return true;
    } catch {
      doc.setFont("helvetica", "normal");
      family = "helvetica";
      safe = pdfSafe;
      return false;
    }
  };
  if (fonts && !(fonts.cjk && applyCjk(fonts.cjk))) {
    try {
      const supported = parseCmap(fonts.regular);
      const boldSupported = parseCmap(fonts.bold);
      doc.addFileToVFS("NotoSans-Regular.ttf", toBase64(fonts.regular));
      doc.addFont("NotoSans-Regular.ttf", UNICODE_FAMILY, "normal");
      doc.addFileToVFS("NotoSans-Bold.ttf", toBase64(fonts.bold));
      doc.addFont("NotoSans-Bold.ttf", UNICODE_FAMILY, "bold");
      if (supported.size === 0 || boldSupported.size === 0) throw new Error("unreadable font");
      verifyFamily(UNICODE_FAMILY, "Ab");
      family = UNICODE_FAMILY;
      safe = (t) => pdfText(t, (c) => supported.has(c) && boldSupported.has(c));
    } catch {
      family = "helvetica";
      safe = pdfSafe;
    }
  }

  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(safe(text), width) as string[];

  // A line drawn with its baseline at y needs a little room below it; otherwise it starts the next page.
  const startFresh = (ascent: number, restore: () => void) => {
    doc.addPage();
    paintPage();
    y = MARGIN + ascent;
    restore();
  };
  const setTitleFont = () => {
    doc.setFont(family, "bold");
    doc.setFontSize(24);
  };
  const setInfoFont = (size: number) => () => {
    doc.setFont(family, "normal");
    doc.setFontSize(size);
    textRgb(doc, PDF_THEME.muted);
  };

  // Accent bar above the title, like the accent used for the app's highlights.
  fillRgb(doc, PDF_THEME.accent);
  doc.roundedRect(MARGIN, y, 56, 4, 2, 2, "F");
  y += 10;
  setTitleFont();
  textRgb(doc, PDF_THEME.foreground);
  const title = wrap(input.tripName, contentW);
  y += 20;
  for (const line of title) {
    if (y + 8 > limit) startFresh(20, () => { setTitleFont(); textRgb(doc, PDF_THEME.foreground); });
    doc.text(line, MARGIN, y);
    y += 28;
  }
  y -= 8;

  setInfoFont(11)();
  for (const line of [input.dateLine, input.startLine, input.routeLine]) {
    if (!line) continue;
    for (const l of wrap(line, contentW)) {
      if (y + 4 > limit) startFresh(11, setInfoFont(11));
      doc.text(l, MARGIN, y);
      y += 15;
    }
  }
  if (input.note) {
    setInfoFont(10)();
    for (const l of wrap(input.note, contentW)) {
      if (y + 4 > limit) startFresh(10, setInfoFont(10));
      doc.text(l, MARGIN, y);
      y += 13;
    }
  }
  y += 6;

  const mapH = contentW * MAP_ASPECT;
  if (y + mapH > limit) {
    doc.addPage();
    paintPage();
    y = MARGIN;
  }
  if (map.kind === "image") {
    const fmt = /^data:image\/jpe?g/i.test(map.dataUrl) ? "JPEG" : "PNG";
    try {
      // Rounded frame: the image is clipped to it, then the border is drawn over the edge in the app's border colour.
      doc.saveGraphicsState();
      doc.roundedRect(MARGIN, y, contentW, mapH, MAP_RADIUS, MAP_RADIUS, null);
      doc.clip();
      doc.discardPath();
      doc.addImage(map.dataUrl, fmt, MARGIN, y, contentW, mapH);
      doc.restoreGraphicsState();
      drawRgb(doc, PDF_BORDER);
      doc.setLineWidth(1);
      doc.roundedRect(MARGIN, y, contentW, mapH, MAP_RADIUS, MAP_RADIUS, "S");
    } catch {
      // A corrupt image must not lose the whole itinerary: draw the map instead.
      try { doc.restoreGraphicsState(); } catch { /* nothing saved */ }
      drawFallbackMap(doc, family, MARGIN, y, contentW, mapH, geometry, stops, colors);
    }
  } else {
    drawFallbackMap(doc, family, MARGIN, y, contentW, mapH, geometry, stops, colors);
  }
  y += mapH + 24;

  const newPage = () => {
    doc.addPage();
    paintPage();
    y = MARGIN;
  };

  input.stops.forEach((s, stopIdx) => {
    doc.setFontSize(12);
    doc.setFont(family, "bold");
    const arrival = safe(s.arrival);
    const arrivalW = doc.getTextWidth(arrival);
    const heading = wrap(s.name, contentW - STOP_INDENT - arrivalW - 12);

    doc.setFontSize(10);
    doc.setFont(family, "normal");
    // Best-light hints use the app's sand colour; weather and notes stay muted.
    const rawDetails: { text: string | null; color: string }[] = [
      { text: s.bestLight, color: PDF_THEME.sand },
      { text: s.weather, color: PDF_THEME.muted },
      { text: s.notes, color: PDF_THEME.muted },
    ];
    const details = rawDetails
      .filter((d): d is { text: string; color: string } => !!d.text && d.text.trim() !== "")
      .map((d) => ({ lines: wrap(d.text.trim(), contentW - STOP_INDENT), color: d.color }));
    const firstDetail = details[0]?.lines.length ? 13 : 0;
    const headingH = Math.max(heading.length * 15, MARKER_R * 2);
    if (y + headingH + firstDetail > limit) newPage();

    // Numbered disc in the stop's own colour, like the app's dots.
    const fill = colors[stopIdx];
    fillRgb(doc, fill);
    doc.circle(MARGIN + MARKER_R, y + 2 + MARKER_R - 1, MARKER_R, "F");
    textRgb(doc, markerTextColor(fill));
    doc.setFont(family, "bold");
    doc.setFontSize(String(s.index).length > 2 ? 7 : 10);
    doc.text(String(s.index), MARGIN + MARKER_R, y + 2 + MARKER_R - 1 + 3.2, { align: "center" });

    doc.setFontSize(12);
    textRgb(doc, PDF_THEME.foreground);
    heading.forEach((l, i) => {
      doc.text(l, MARGIN + STOP_INDENT, y + 11 + i * 15);
    });
    textRgb(doc, PDF_THEME.accentStrong);
    doc.text(arrival, pageW - MARGIN, y + 11, { align: "right" });
    y += headingH + 2;

    for (const block of details) {
      for (const l of block.lines) {
        if (y + 13 > limit) {
          newPage();
        }
        doc.setFontSize(10);
        doc.setFont(family, "normal");
        textRgb(doc, block.color);
        doc.text(l, MARGIN + STOP_INDENT, y + 9);
        y += 13;
      }
      y += 2;
    }
    y += 5;
    // Divider between stops, not after the last one.
    if (stopIdx < input.stops.length - 1 && y + 6 <= limit) {
      drawRgb(doc, PDF_BORDER);
      doc.setLineWidth(0.75);
      doc.line(MARGIN, y, pageW - MARGIN, y);
    }
    y += 9;
  });

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont(family, "normal");
    doc.setFontSize(9);
    drawRgb(doc, PDF_RULE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, pageH - MARGIN - 4, pageW - MARGIN, pageH - MARGIN - 4);
    textRgb(doc, PDF_THEME.muted);
    doc.text(`Page ${p} of ${total}`, pageW / 2, pageH - MARGIN + 6, { align: "center" });
  }
  return doc.output("blob");
}
