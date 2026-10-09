// Trip export: a GPX file and "open in Maps" links, all built client-side from stops already loaded.

import type { LngLat } from "./types";

export type ExportStop = { name: string; lat: number; lng: number; notes: string | null };

// Anything outside the XML 1.0 Char production (control chars, lone surrogates, U+FFFE/U+FFFF).
const ILLEGAL_XML = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;

function esc(text: string): string {
  return text
    .replace(ILLEGAL_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A plain decimal with up to 7 places ("40.5", never "4e-7"); null for NaN/Infinity so the point is skipped. */
function num(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const t = n.toFixed(7).replace(/\.?0+$/, "");
  return t === "-0" || t === "" ? "0" : t;
}

/** GPX 1.1: a waypoint per stop plus, when given, one track along the driven route. No timestamps. */
export function buildGpx({ name, stops, route }: { name: string; stops: ExportStop[]; route?: LngLat[] | null }): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Photo Op Planner" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${esc(name)}</name></metadata>`,
  ];
  for (const s of stops) {
    const lat = num(s.lat), lon = num(s.lng);
    if (lat === null || lon === null) continue;
    lines.push(`  <wpt lat="${lat}" lon="${lon}">`, `    <name>${esc(s.name)}</name>`);
    if (s.notes) lines.push(`    <desc>${esc(s.notes)}</desc>`);
    lines.push("  </wpt>");
  }
  if (route && route.length > 0) {
    lines.push("  <trk>", `    <name>${esc(name)}</name>`, "    <trkseg>");
    for (const [lng, lat] of route) {
      const la = num(lat), lo = num(lng);
      if (la !== null && lo !== null) lines.push(`      <trkpt lat="${la}" lon="${lo}"/>`);
    }
    lines.push("    </trkseg>", "  </trk>");
  }
  lines.push("</gpx>", "");
  return lines.join("\n");
}

/** A safe download name: ASCII letters, digits, dashes and underscores only; `trip-<date>.gpx` when nothing usable is left. */
export function gpxFileName(tripName: string, date: string = new Date().toISOString().slice(0, 10)): string {
  const slug = tripName
    .replace(/[^A-Za-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || `trip-${date.replace(/[^0-9-]/g, "")}`}.gpx`;
}

const point = (s: ExportStop) => `${num(s.lat) ?? 0},${num(s.lng) ?? 0}`;

// Google's directions link allows an origin, a destination and at most 9 waypoints between.
const GOOGLE_MAX_WAYPOINTS = 9;

export type MapsLink = { label: string; url: string };

/** Google Maps directions links; more than 11 stops are split into consecutive parts that share an end point. Null under 2 stops. */
export function googleMapsUrl(stops: ExportStop[]): MapsLink[] | null {
  if (stops.length < 2) return null;
  const span = GOOGLE_MAX_WAYPOINTS + 1; // stops advanced per part
  const chunks: ExportStop[][] = [];
  for (let i = 0; i < stops.length - 1; i += span) chunks.push(stops.slice(i, i + span + 1));
  return chunks.map((chunk, i) => {
    const params = new URLSearchParams({ api: "1", origin: point(chunk[0]), destination: point(chunk[chunk.length - 1]) });
    if (chunk.length > 2) params.set("waypoints", chunk.slice(1, -1).map(point).join("|"));
    return {
      label: chunks.length > 1 ? `Part ${i + 1}/${chunks.length}` : "",
      url: `https://www.google.com/maps/dir/?${params.toString()}`,
    };
  });
}

// Each "to:" stop adds ~25 characters; 20 stops per link keeps the URL well under any practical length limit.
export const APPLE_MAX_STOPS_PER_LINK = 20;

/** Apple Maps links; more than 20 stops are split into consecutive parts that share an end point, like the Google links. Null under 2 stops. */
export function appleMapsUrls(stops: ExportStop[]): MapsLink[] | null {
  if (stops.length < 2) return null;
  const chunks: ExportStop[][] = [];
  for (let i = 0; i < stops.length - 1; i += APPLE_MAX_STOPS_PER_LINK - 1) chunks.push(stops.slice(i, i + APPLE_MAX_STOPS_PER_LINK));
  return chunks.map((chunk, i) => ({
    label: chunks.length > 1 ? `Part ${i + 1}/${chunks.length}` : "",
    url: appleMapsUrl(chunk)!,
  }));
}

/** Apple Maps directions link: first stop to the last, via the rest ("+to:" chained), however many stops are passed. Null under 2 stops. */
export function appleMapsUrl(stops: ExportStop[]): string | null {
  if (stops.length < 2) return null;
  const params = new URLSearchParams({ saddr: point(stops[0]), daddr: stops.slice(1).map(point).join(" to:") });
  return `https://maps.apple.com/?${params.toString()}`;
}
