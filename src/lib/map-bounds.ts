export type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };
type LatLng = { lat: number; lng: number };

export function pixelToLatLng(b: Bounds, x: number, y: number, width: number, height: number): LatLng {
  return {
    lat: b.maxLat - (y / height) * (b.maxLat - b.minLat),
    lng: b.minLng + (x / width) * (b.maxLng - b.minLng),
  };
}

export function latLngToPercent(b: Bounds, p: LatLng): { left: number; top: number } {
  return {
    left: ((p.lng - b.minLng) / (b.maxLng - b.minLng)) * 100,
    top: ((b.maxLat - p.lat) / (b.maxLat - b.minLat)) * 100,
  };
}

/** Web Mercator cannot show the poles; fits are clamped to this latitude so a stop at 89.9 still frames. */
export const MAX_FIT_LAT = 85;

/**
 * Points ready for a min/max bounding box: longitudes are unwrapped so a trip across the antimeridian (179.5 and -179.5)
 * is framed the short way (the west side gets +360, so the box runs 179.5..180.5), and latitudes are clamped to the
 * Mercator limit. The order and count of the points are kept.
 */
export function unwrapForFit(points: [lng: number, lat: number][]): [lng: number, lat: number][] {
  const clamped = points.map(([lng, lat]): [number, number] => [lng, Math.max(-MAX_FIT_LAT, Math.min(MAX_FIT_LAT, lat))]);
  if (clamped.length < 2) return clamped;
  const norm = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
  const sorted = [...new Set(clamped.map(([lng]) => norm(lng)))].sort((a, b) => a - b);
  if (sorted.length < 2) return clamped.map(([lng, lat]) => [norm(lng), lat]);
  // The largest empty stretch of longitude is the part to leave out of the box.
  let gap = sorted[0]! + 360 - sorted[sorted.length - 1]!;
  let cutAfter = -1; // -1: the gap is the one across the antimeridian, nothing to shift
  for (let i = 0; i < sorted.length - 1; i++) {
    const g = sorted[i + 1]! - sorted[i]!;
    if (g > gap) { gap = g; cutAfter = i; }
  }
  const limit = cutAfter >= 0 ? sorted[cutAfter]! : -Infinity;
  return clamped.map(([lng, lat]) => {
    const n = norm(lng);
    return [n <= limit ? n + 360 : n, lat];
  });
}
