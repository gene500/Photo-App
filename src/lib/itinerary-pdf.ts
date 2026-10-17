// Draws the itinerary as an A4 PDF with jsPDF (loaded on demand, never at module load).

import { downsampleRoute } from "./downsample";
import { parseCmap, pdfText, type PdfFonts } from "./pdf-fonts";
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

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const MARGIN = 40;
const MAP_ASPECT = STATIC_MAP_HEIGHT / STATIC_MAP_WIDTH;
const FOOTER_SPACE = 30;
const INDENT = 16;
const GREY = 110;

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

function drawFallbackMap(doc: Doc, family: string, x: number, y: number, w: number, h: number, geometry: LngLat[], stops: { lat: number; lng: number }[]) {
  doc.setFillColor(243, 244, 246);
  doc.setDrawColor(200, 200, 200);
  doc.rect(x, y, w, h, "FD");
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
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(2);
    doc.lines(deltas, a[0][0], a[0][1], [1, 1], "S", false);
  }
  doc.setFontSize(8);
  stopPts.forEach((p, i) => {
    const [cx, cy] = at(p);
    doc.setFillColor(225, 29, 72);
    doc.circle(cx, cy, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont(family, "bold");
    doc.text(String(i + 1), cx, cy + 2.8, { align: "center" });
  });
  doc.setTextColor(0, 0, 0);
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

  // With the Unicode font only its own gaps become "?"; without it (offline, failed fetch) the WinAnsi rule applies.
  let family = "helvetica";
  let safe = pdfSafe;
  if (fonts) {
    try {
      const supported = parseCmap(fonts.regular);
      const boldSupported = parseCmap(fonts.bold);
      doc.addFileToVFS("NotoSans-Regular.ttf", toBase64(fonts.regular));
      doc.addFont("NotoSans-Regular.ttf", UNICODE_FAMILY, "normal");
      doc.addFileToVFS("NotoSans-Bold.ttf", toBase64(fonts.bold));
      doc.addFont("NotoSans-Bold.ttf", UNICODE_FAMILY, "bold");
      if (supported.size === 0 || boldSupported.size === 0) throw new Error("unreadable font");
      family = UNICODE_FAMILY;
      safe = (t) => pdfText(t, (c) => supported.has(c) && boldSupported.has(c));
    } catch {
      family = "helvetica";
      safe = pdfSafe;
    }
  }

  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(safe(text), width) as string[];

  doc.setFont(family, "bold");
  doc.setFontSize(24);
  const title = wrap(input.tripName, contentW);
  y += 20;
  for (const line of title) {
    doc.text(line, MARGIN, y);
    y += 28;
  }
  y -= 8;

  doc.setFont(family, "normal");
  doc.setFontSize(11);
  doc.setTextColor(GREY);
  for (const line of [input.dateLine, input.startLine, input.routeLine]) {
    if (!line) continue;
    for (const l of wrap(line, contentW)) {
      doc.text(l, MARGIN, y);
      y += 15;
    }
  }
  if (input.note) {
    doc.setFontSize(10);
    for (const l of wrap(input.note, contentW)) {
      doc.text(l, MARGIN, y);
      y += 13;
    }
  }
  doc.setTextColor(0, 0, 0);
  y += 6;

  const mapH = contentW * MAP_ASPECT;
  if (y + mapH > limit) {
    doc.addPage();
    y = MARGIN;
  }
  if (map.kind === "image") {
    const fmt = /^data:image\/jpe?g/i.test(map.dataUrl) ? "JPEG" : "PNG";
    try {
      doc.addImage(map.dataUrl, fmt, MARGIN, y, contentW, mapH);
    } catch {
      // A corrupt image must not lose the whole itinerary: draw the map instead.
      drawFallbackMap(doc, family, MARGIN, y, contentW, mapH, geometry, stops);
    }
  } else {
    drawFallbackMap(doc, family, MARGIN, y, contentW, mapH, geometry, stops);
  }
  y += mapH + 24;

  const newPage = () => {
    doc.addPage();
    y = MARGIN;
  };

  for (const s of input.stops) {
    doc.setFontSize(12);
    doc.setFont(family, "bold");
    const arrival = safe(s.arrival);
    const arrivalW = doc.getTextWidth(arrival);
    const heading = wrap(`${s.index}. ${s.name}`, contentW - arrivalW - 12);

    doc.setFontSize(10);
    doc.setFont(family, "normal");
    const details = [s.bestLight, s.weather, s.notes]
      .filter((t): t is string => !!t && t.trim() !== "")
      .map((t) => wrap(t.trim(), contentW - INDENT));
    const firstDetail = details[0]?.length ? 13 : 0;
    const headingH = heading.length * 15;
    if (y + headingH + firstDetail > limit) newPage();

    doc.setFontSize(12);
    doc.setFont(family, "bold");
    heading.forEach((l, i) => {
      doc.text(l, MARGIN, y + 11 + i * 15);
    });
    doc.text(arrival, pageW - MARGIN, y + 11, { align: "right" });
    y += headingH + 2;

    doc.setFontSize(10);
    doc.setFont(family, "normal");
    doc.setTextColor(GREY);
    for (const block of details) {
      for (const l of block) {
        if (y + 13 > limit) {
          newPage();
          doc.setFontSize(10);
          doc.setFont(family, "normal");
          doc.setTextColor(GREY);
        }
        doc.text(l, MARGIN + INDENT, y + 9);
        y += 13;
      }
      y += 2;
    }
    doc.setTextColor(0, 0, 0);
    y += 10;
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont(family, "normal");
    doc.setFontSize(9);
    doc.setTextColor(GREY);
    doc.text(`Page ${p} of ${total}`, pageW / 2, pageH - MARGIN + 6, { align: "center" });
  }
  return doc.output("blob");
}
