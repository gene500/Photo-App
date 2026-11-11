const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Rough average road speed and winding factor for estimating drive time without a routing call. */
const AVG_KMH = 80;
const WINDING = 1.3;

/**
 * Estimated seconds per leg from straight-line distances (the public page cannot call the routing API).
 * Same arithmetic as `haversineMeters` per leg, but each stop's cosine of latitude is computed once and reused.
 */
export function estimateLegDurations(stops: { lat: number; lng: number }[]): number[] {
  const out: number[] = [];
  if (stops.length < 2) return out;
  let aLat = stops[0]!.lat;
  let aLng = stops[0]!.lng;
  let cosA = Math.cos(toRad(aLat));
  for (let i = 1; i < stops.length; i++) {
    const s = stops[i]!;
    const dLat = toRad(s.lat - aLat);
    const dLng = toRad(s.lng - aLng);
    const cosB = Math.cos(toRad(s.lat));
    const h = Math.sin(dLat / 2) ** 2 + cosA * cosB * Math.sin(dLng / 2) ** 2;
    const m = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
    out.push(Math.round(((m * WINDING) / 1000 / AVG_KMH) * 3600));
    aLat = s.lat;
    aLng = s.lng;
    cosA = cosB;
  }
  return out;
}
