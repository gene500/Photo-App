const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function coordsLabel(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}

/** Normalise a longitude (e.g. from a map panned across the antimeridian) into [-180, 180]. */
export function wrapLng(lng: number): number {
  if (lng >= -180 && lng <= 180) return lng;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

const EARTH_RADIUS_KM = 6371.0088;

/**
 * The point `distanceKm` from `origin` along a great circle, heading `bearing` degrees clockwise from north.
 * The longitude is not wrapped (it can pass +-180), so a line from the origin to it takes the short way on a map.
 */
export function bearingEndpoint(
  origin: { lat: number; lng: number },
  bearing: number,
  distanceKm: number,
): [lng: number, lat: number] {
  const d = distanceKm / EARTH_RADIUS_KM;
  const lat1 = toRad(origin.lat);
  const brng = toRad(bearing);
  const sinLat2 = Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const dLng = Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * sinLat2);
  return [origin.lng + (dLng * 180) / Math.PI, (lat2 * 180) / Math.PI];
}
