import type { LngLat, Suggestion } from "@/lib/types";

/** EXTERNAL_APIS_FAKE=1 swaps Mapbox/Overpass for canned data (e2e tests, offline dev). */
export function isFakeExternal(): boolean {
  return process.env.EXTERNAL_APIS_FAKE === "1";
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
