import { downsampleRoute } from "./downsample";
import type { LngLat } from "./types";

export const STATIC_MAP_MAX_URL = 7500;

const MAX_SIDE = 1280;
const START_POINTS = 1000;
const ROUTE_COLOR = "2563eb";
const PIN_COLOR = "e11d48";

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** Google polyline algorithm, precision 5. Input is [lng, lat]; output is unescaped. */
export function encodePolyline(points: LngLat[]): string {
  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  for (const [lng, lat] of points) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += encodeValue(la - prevLat) + encodeValue(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

const clampSide = (n: number) => Math.max(1, Math.min(MAX_SIDE, Math.round(n)));

export function staticMapUrl(a: {
  stops: { lat: number; lng: number }[];
  geometry: LngLat[];
  token: string | null;
  width?: number;
  height?: number;
}): string | null {
  if (!a.token || a.stops.length < 2) return null;
  const w = clampSide(a.width ?? 640);
  const h = clampSide(a.height ?? 400);
  const pins = a.stops.map((s, i) => {
    const label = i + 1 <= 99 ? `-${i + 1}` : "";
    return `pin-s${label}+${PIN_COLOR}(${s.lng.toFixed(5)},${s.lat.toFixed(5)})`;
  });
  const build = (path: string | null) =>
    `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${[...(path ? [path] : []), ...pins].join(",")}/auto/${w}x${h}@2x?access_token=${encodeURIComponent(a.token!)}`;

  const noPath = build(null);
  if (noPath.length > STATIC_MAP_MAX_URL) return null;
  if (a.geometry.length < 2) return noPath;

  for (let target = START_POINTS; target >= 2; target = Math.floor(target / 2)) {
    const pts = downsampleRoute(a.geometry, target);
    const url = build(`path-4+${ROUTE_COLOR}-0.9(${encodeURIComponent(encodePolyline(pts))})`);
    if (url.length <= STATIC_MAP_MAX_URL) return url;
  }
  return noPath;
}
