export type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };
type LatLng = { lat: number; lng: number };

const MIN_PAD_DEG = 0.05;

export function boundsFor(points: LatLng[], padFraction = 0.2): Bounds {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const latPad = Math.max((maxLat - minLat) * padFraction, MIN_PAD_DEG);
  const lngPad = Math.max((maxLng - minLng) * padFraction, MIN_PAD_DEG);
  return { minLat: minLat - latPad, maxLat: maxLat + latPad, minLng: minLng - lngPad, maxLng: maxLng + lngPad };
}

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
