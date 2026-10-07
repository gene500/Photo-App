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
