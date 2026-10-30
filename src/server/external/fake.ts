import { coordsLabel, haversineMeters } from "@/lib/geo";
import { OSM_ATTRIBUTION, type Hike } from "@/lib/hike";
import { addDays } from "@/lib/weather";
import type { LngLat, Place, PlaceNotice, PlacePhoto, RouteResult, SearchSuggestion, Suggestion, WeatherForecast, WeatherHour } from "@/lib/types";

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

/** Fake area lookup: only names that read like a park or well-known place resolve, as with the real service, so an ordinary trip name ("Reopen me") finds nothing. */
export function fakeLocate(query: string): Place | null {
  return /national park|yosemite|arches|grand canyon|zion/i.test(query) ? (fakeGeocode(query)[0] ?? null) : null;
}

const FAKE_LANDMARKS = [
  { id: "fake-horseshoe-bend", name: "Horseshoe Bend", subtitle: "viewpoint · Page, Arizona", place: "Page, Arizona", lat: 36.8791, lng: -111.51 },
  { id: "fake-griffith-observatory", name: "Griffith Observatory", subtitle: "landmark · Los Angeles, California", place: "Los Angeles, California", lat: 34.1184, lng: -118.3004 },
  { id: "fake-yosemite-valley-viewpoint", name: "Yosemite Valley Viewpoint", subtitle: "viewpoint · Yosemite Valley, California", place: "Yosemite Valley, California", lat: 37.7159, lng: -119.6775 },
];

/** Landmarks whose name contains the query, then the old fake address (which already has coordinates). */
export function fakeSearch(query: string): SearchSuggestion[] {
  const q = query.trim().toLowerCase();
  const landmarks = FAKE_LANDMARKS.filter((l) => l.name.toLowerCase().includes(q)).map((l) => ({ name: l.name, subtitle: l.subtitle, mapboxId: l.id }));
  return [...landmarks, ...fakeGeocode(query)];
}

export function fakeRetrieve(id: string): Place | null {
  const l = FAKE_LANDMARKS.find((x) => x.id === id);
  return l ? { name: `${l.name}, ${l.place}`, lat: l.lat, lng: l.lng } : null;
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

/** The one place with a fake hike (the middle of the fake map). Any point within FAKE_HIKE_RADIUS_DEG of it has one; everywhere else has none. */
export const FAKE_HIKE_POINT = { lat: 37, lng: -119.5 };
export const FAKE_HIKE_RADIUS_DEG = 0.05;

/** A canned hike of about 1.2 mi ending at the point, or null away from FAKE_HIKE_POINT. */
export function fakeHike(lat: number, lng: number): Hike | null {
  if (Math.abs(lat - FAKE_HIKE_POINT.lat) > FAKE_HIKE_RADIUS_DEG || Math.abs(lng - FAKE_HIKE_POINT.lng) > FAKE_HIKE_RADIUS_DEG) return null;
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  const offsets: [number, number][] = ([[-0.02, -0.004], [-0.016, -0.001], [-0.011, 0.002], [-0.006, -0.001], [-0.002, 0.001], [0, 0]] as [number, number][]).map(([dx, dy]) => [dx * 0.865, dy * 0.865]);
  const geometry = offsets.map(([dx, dy]): LngLat => [r(lng + dx), r(lat + dy)]);
  let distanceMeters = 0;
  for (let i = 1; i < geometry.length; i++) distanceMeters += haversineMeters({ lat: geometry[i - 1][1], lng: geometry[i - 1][0] }, { lat: geometry[i][1], lng: geometry[i][0] });
  return { distanceMeters: Math.round(distanceMeters / 10) * 10, geometry, source: "osm", attribution: OSM_ATTRIBUTION };
}

/** Fake heads-ups (no network): a stop near Tioga Pass (Yosemite) gets a closed-road notice, one near Horseshoe Bend a closed-at-arrival one. */
export function fakePlaceNotices(stops: { lat: number; lng: number }[]): PlaceNotice[] {
  return stops.flatMap((s, i): PlaceNotice[] => {
    if (Math.abs(s.lat - 37.91) < 0.1 && Math.abs(s.lng + 119.26) < 0.1) return [{ stopIndex: i, kind: "closed", text: "Tioga Road: closed for the season (NPS alert)", source: "NPS" }];
    if (Math.abs(s.lat - 36.8791) < 0.01 && Math.abs(s.lng + 111.51) < 0.01) return [{ stopIndex: i, kind: "hours", text: "Check the hours: open 09:00-17:00 (OpenStreetMap)", source: "OpenStreetMap" }];
    return [];
  });
}
