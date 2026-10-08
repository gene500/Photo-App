import { coordsLabel, haversineMeters } from "@/lib/geo";
import { addDays } from "@/lib/weather";
import type { LngLat, Place, PlacePhoto, RouteResult, Suggestion, WeatherForecast, WeatherHour } from "@/lib/types";

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

/** Square drive-time matrix in seconds; diagonal is 0. */
export function fakeDurationMatrix(coords: LngLat[]): number[][] {
  return coords.map(([aLng, aLat]) =>
    coords.map(([bLng, bLat]) => haversineMeters({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng }) / FAKE_SPEED_MPS),
  );
}

export function fakeSuggestions(route: LngLat[]): Suggestion[] {
  const [lng, lat] = route[Math.floor(route.length / 2)];
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return [
    { osmId: "node/9000001", name: "Fake Viewpoint", lat: r(lat + 0.01), lng, kind: "viewpoint", popularity: 1234 },
    { osmId: "node/9000002", name: "Fake Peak", lat, lng: r(lng + 0.01), kind: "peak", popularity: 87 },
    { osmId: "node/9000003", name: "Fake Attraction", lat: r(lat - 0.01), lng, kind: "attraction", popularity: 2500 },
  ];
}

export function fakeGeocode(query: string): Place[] {
  const h = [...query].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 100_000, 7);
  return [{ name: `${query.trim()} (fake)`, lat: 36 + (h % 200) / 100, lng: -121 + (Math.floor(h / 200) % 300) / 100 }];
}

export function fakeReverseGeocode(p: { lat: number; lng: number }): Place {
  return { name: `Spot ${coordsLabel(p)} (fake)`, lat: p.lat, lng: p.lng };
}

/** Deterministic inline-SVG placeholder (no network): the hue comes from the place name. */
export function fakePlacePhoto(p: { name: string }): PlacePhoto {
  const hue = [...p.name].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 17);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">` +
    `<rect width="480" height="300" fill="hsl(${hue} 30% 80%)"/>` +
    `<path d="M0 230 L140 120 L230 200 L330 90 L480 230 V300 H0 Z" fill="hsl(${hue} 25% 55%)"/></svg>`;
  return {
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    title: p.name,
    pageUrl: "https://en.wikipedia.org/wiki/Special:Random",
    credit: "Photo: Wikipedia",
  };
}

/** Deterministic hourly forecast for each day start..end (no network): cloud cover drifts through the day, seeded by place and date. */
export function fakeWeather(p: { lat: number; lng: number }, start: string, end: string): WeatherForecast {
  const hours: WeatherHour[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const seed = [...`${p.lat.toFixed(2)},${p.lng.toFixed(2)},${date}`].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1000, 11);
    for (let h = 0; h < 24; h++) {
      hours.push({
        time: `${date}T${String(h).padStart(2, "0")}:00`,
        cloudPct: Math.round(((seed + h * 37) % 60) + 5), // 5..64: clear to mostly cloudy
        rainPct: (seed + h * 11) % 30,
        tempC: 12 + (h < 14 ? h : 28 - h) * 0.8,
      });
    }
  }
  return { available: true, utcOffsetSeconds: Math.round(p.lng / 15) * 3600, hours };
}
