import { downsampleRoute } from "./downsample";
import { ACCESS_TRAIL_COLOR } from "./map-theme";
import type { LngLat } from "./types";

export const STATIC_MAP_MAX_URL = 7500;
export const STATIC_MAP_WIDTH = 640;
export const STATIC_MAP_HEIGHT = 400;

const MAX_SIDE = 1280;
const START_POINTS = 1000;
/** The app's route colour (--route) and manual stop colour, so the printed map matches the screen. */
const STATIC_MAP_ROUTE_COLOR = "a8834b";
const PIN_COLOR = "3b3226";
/** Road-end trails: ACCESS_TRAIL_COLOR without "#". Static images have no dashes, so this is a thin solid line. */
const STATIC_MAP_TRAIL_COLOR = ACCESS_TRAIL_COLOR.replace("#", "");
const TRAIL_MAX_POINTS = 20;

const pinColor = (c: string | undefined) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? c.replace("#", "").toLowerCase() : PIN_COLOR);

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
  stops: { lat: number; lng: number; /** Hex pin colour such as "#b4572f"; defaults to the manual stop colour. */ color?: string }[];
  geometry: LngLat[];
  token: string | null;
  width?: number;
  height?: number;
  /** Road-end trails; each is cut to 20 points, and all are dropped first when the URL would be too long. */
  trails?: LngLat[][];
}): string | null {
  if (!a.token || a.stops.length < 2) return null;
  const w = clampSide(a.width ?? STATIC_MAP_WIDTH);
  const h = clampSide(a.height ?? STATIC_MAP_HEIGHT);
  const pins = a.stops.map((s, i) => {
    const label = i + 1 <= 99 ? `-${i + 1}` : "";
    return `pin-s${label}+${pinColor(s.color)}(${s.lng.toFixed(5)},${s.lat.toFixed(5)})`;
  });
  const trailPaths = (a.trails ?? [])
    .filter((t) => t.length >= 2)
    .map((t) => `path-2+${STATIC_MAP_TRAIL_COLOR}-0.9(${encodeURIComponent(encodePolyline(downsampleRoute(t, TRAIL_MAX_POINTS)))})`);
  const build = (path: string | null, withTrails = false) =>
    `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${[...(path ? [path] : []), ...(withTrails ? trailPaths : []), ...pins].join(",")}/auto/${w}x${h}@2x?access_token=${encodeURIComponent(a.token!)}`;

  const noPath = build(null);
  if (noPath.length > STATIC_MAP_MAX_URL) return null;
  const withTrailsOk = (path: string | null, base: string) => {
    if (trailPaths.length === 0) return base;
    const url = build(path, true);
    return url.length <= STATIC_MAP_MAX_URL ? url : base;
  };
  if (a.geometry.length < 2) return withTrailsOk(null, noPath);

  for (let target = START_POINTS; target >= 2; target = Math.floor(target / 2)) {
    const pts = downsampleRoute(a.geometry, target);
    const path = `path-4+${STATIC_MAP_ROUTE_COLOR}-0.9(${encodeURIComponent(encodePolyline(pts))})`;
    const url = build(path);
    if (url.length <= STATIC_MAP_MAX_URL) return withTrailsOk(path, url);
  }
  return withTrailsOk(null, noPath);
}
