import { haversineMeters } from "@/lib/geo";
import type { LngLat, Place, RouteResult, Suggestion } from "@/lib/types";

/** EXTERNAL_APIS_FAKE=1 swaps Mapbox/Overpass for canned data (e2e tests, offline dev). */
export function isFakeExternal(): boolean {
  return process.env.EXTERNAL_APIS_FAKE === "1";
}

const FAKE_SPEED_MPS = 25; // ~90 km/h

export function fakeDirections(coords: LngLat[]): RouteResult {
  const legs = coords.slice(1).map(([lng, lat], i) => {
    const [pLng, pLat] = coords[i];
    const distance = haversineMeters({ lat: pLat, lng: pLng }, { lat, lng });
    return { distance, duration: distance / FAKE_SPEED_MPS };
  });
  return {
    geometry: coords,
    legs,
    distance: legs.reduce((sum, l) => sum + l.distance, 0),
    duration: legs.reduce((sum, l) => sum + l.duration, 0),
  };
}

export function fakeSuggestions(route: LngLat[]): Suggestion[] {
  const [lng, lat] = route[Math.floor(route.length / 2)];
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return [
    { osmId: "node/9000001", name: "Fake Viewpoint", lat: r(lat + 0.01), lng, kind: "viewpoint" },
    { osmId: "node/9000002", name: "Fake Peak", lat, lng: r(lng + 0.01), kind: "peak" },
    { osmId: "node/9000003", name: "Fake Attraction", lat: r(lat - 0.01), lng, kind: "attraction" },
  ];
}

export function fakeGeocode(query: string): Place[] {
  const h = [...query].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 100_000, 7);
  return [{ name: `${query.trim()} (fake)`, lat: 36 + (h % 200) / 100, lng: -121 + (Math.floor(h / 200) % 300) / 100 }];
}
