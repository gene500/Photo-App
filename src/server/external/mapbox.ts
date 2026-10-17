import type { LngLat, Place, RouteResult, SearchSuggestion } from "@/lib/types";
import { coordsLabel } from "@/lib/geo";
import { TtlCache } from "../suggestions/cache";
import { fakeDirections, fakeDurationMatrix, fakeGeocode, fakeRetrieve, fakeReverseGeocode, fakeSearch, isFakeExternal } from "./fake";

const MAPBOX_BASE = "https://api.mapbox.com";
const TIMEOUT_MS = 10_000;

/** Messages are user-safe; routes pass them straight to the client. */
export class ExternalServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalServiceError";
  }
}

type DirectionsResponse = {
  code?: string;
  routes?: {
    geometry: { coordinates: LngLat[] };
    legs: { distance: number; duration: number }[];
    distance: number;
    duration: number;
  }[];
};

function token(): string {
  const t = process.env.MAPBOX_TOKEN;
  if (!t) {
    // Config state is for the logs, not the client.
    console.error("Mapbox is not configured (MAPBOX_TOKEN is missing)");
    throw new ExternalServiceError("Service temporarily unavailable");
  }
  return t;
}

async function getJson<T>(url: string, fetchImpl: typeof fetch, unreachable: string): Promise<{ ok: boolean; body: T | null }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ExternalServiceError(unreachable);
  }
  const body = (await res.json().catch(() => null)) as T | null;
  return { ok: res.ok, body };
}

/** Routes between the same stops are asked for on every page open; Mapbox charges per request and takes a second. */
const DIRECTIONS_TTL_MS = 10 * 60_000;
const directionsCache = new TtlCache<RouteResult>(DIRECTIONS_TTL_MS, 200);

/** Search and click-to-name lookups repeat a lot (typing, re-clicking); each uncached one is a billed Mapbox call. */
const LOOKUP_TTL_MS = 10 * 60_000;
const geocodeCache = new TtlCache<Place[]>(LOOKUP_TTL_MS, 300);
const reverseCache = new TtlCache<Place>(LOOKUP_TTL_MS, 300);
const searchCache = new TtlCache<SearchSuggestion[]>(LOOKUP_TTL_MS, 300);
const retrieveCache = new TtlCache<Place>(LOOKUP_TTL_MS, 300);
const matrixCache = new TtlCache<number[][]>(LOOKUP_TTL_MS, 100);

export function clearMapboxCaches(): void {
  directionsCache.clear();
  geocodeCache.clear();
  reverseCache.clear();
  searchCache.clear();
  retrieveCache.clear();
  matrixCache.clear();
}

const isLngLat = (c: unknown): c is LngLat =>
  Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
const isNonNegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const BAD_ROUTING_RESPONSE = "Unexpected response from the routing service. Please try again.";

export async function getDirections(coords: LngLat[], fetchImpl: typeof fetch = fetch): Promise<RouteResult> {
  if (isFakeExternal()) return fakeDirections(coords);
  const path = coords.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const cached = directionsCache.get(path);
  if (cached) return cached;
  const url =
    `${MAPBOX_BASE}/directions/v5/mapbox/driving/${path}` +
    `?geometries=geojson&overview=full&access_token=${encodeURIComponent(token())}`;
  const { ok, body } = await getJson<DirectionsResponse>(url, fetchImpl, "Couldn't reach the routing service");
  const route = body?.routes?.[0];
  if (!ok || body?.code !== "Ok" || !route) {
    throw new ExternalServiceError(
      body?.code === "NoRoute" ? "No driving route found between these points" : "Routing failed. Please try again.",
    );
  }
  if (!Array.isArray(route.geometry?.coordinates) || !Array.isArray(route.legs) || !isNonNegative(route.distance) || !isNonNegative(route.duration)
    || !route.legs.every((l) => l && isNonNegative(l.distance) && isNonNegative(l.duration))) throw new ExternalServiceError(BAD_ROUTING_RESPONSE);
  const result: RouteResult = {
    geometry: route.geometry.coordinates,
    legs: route.legs.map((l) => ({ distance: l.distance, duration: l.duration })),
    distance: route.distance,
    duration: route.duration,
  };
  directionsCache.set(path, result);
  return result;
}

type MatrixResponse = { code?: string; durations?: (number | null)[][] };

const MAX_MATRIX_COORDINATES = 25; // Mapbox Matrix API driving profile limit

/** Drive seconds between every pair of coords; unreachable pairs come back as Infinity. */
export async function getDurationMatrix(coords: LngLat[], fetchImpl: typeof fetch = fetch): Promise<number[][]> {
  if (coords.length > MAX_MATRIX_COORDINATES) {
    throw new ExternalServiceError(`Route optimization supports at most ${MAX_MATRIX_COORDINATES} stops`);
  }
  if (isFakeExternal()) return fakeDurationMatrix(coords);
  const path = coords.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const cachedMatrix = matrixCache.get(path);
  if (cachedMatrix) return cachedMatrix;
  const url =
    `${MAPBOX_BASE}/directions-matrix/v1/mapbox/driving/${path}` +
    `?annotations=duration&access_token=${encodeURIComponent(token())}`;
  const { ok, body } = await getJson<MatrixResponse>(url, fetchImpl, "Couldn't reach the routing service");
  const rows = body?.durations;
  const square = Array.isArray(rows) && rows.length === coords.length && rows.every((r) => Array.isArray(r) && r.length === coords.length);
  if (!ok || body?.code !== "Ok" || !square) {
    throw new ExternalServiceError("Couldn't calculate drive times. Please try again.");
  }
  // null means unreachable; anything else must be a plain non-negative number.
  if (!rows.every((row) => row.every((v) => v === null || isNonNegative(v)))) throw new ExternalServiceError(BAD_ROUTING_RESPONSE);
  const matrix = rows.map((row) => row.map((v) => (typeof v === "number" ? v : Infinity)));
  matrixCache.set(path, matrix);
  return matrix;
}

type GeocodeResponse = {
  features?: {
    geometry: { coordinates: [number, number] };
    properties: { name?: string; full_address?: string };
  }[];
};

const MAX_NAME_LENGTH = 200; // matches newStopSchema's name limit
const clampName = (name: string) => name.slice(0, MAX_NAME_LENGTH);
/** The first usable name: Mapbox fields of the wrong type are skipped. */
const pickName = (p: { full_address?: unknown; name?: unknown } | undefined, fallback: string) =>
  clampName([p?.full_address, p?.name].find((n): n is string => typeof n === "string" && n !== "") ?? fallback);

export type GeocodeOptions = { proximity?: { lat: number; lng: number } };

export async function geocode(query: string, options: GeocodeOptions = {}, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  if (isFakeExternal()) return fakeGeocode(query);
  const proximity = options.proximity
    ? `&proximity=${options.proximity.lng.toFixed(6)},${options.proximity.lat.toFixed(6)}`
    : "";
  const cacheKey = `${query.toLowerCase()}|${proximity}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;
  const url =
    `${MAPBOX_BASE}/search/geocode/v6/forward?q=${encodeURIComponent(query)}` +
    `&autocomplete=true&limit=5${proximity}&access_token=${encodeURIComponent(token())}`;
  const { ok, body } = await getJson<GeocodeResponse>(url, fetchImpl, "Couldn't reach the place search service");
  if (!ok || !body?.features) throw new ExternalServiceError("Place search failed. Please try again.");
  const places = body.features
    .filter((f) => f && isLngLat(f.geometry?.coordinates))
    .map((f) => ({
      name: pickName(f.properties, query),
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
  geocodeCache.set(cacheKey, places);
  return places;
}

type SearchBoxSuggestion = {
  name?: string;
  mapbox_id?: string;
  feature_type?: string;
  poi_category?: string[];
  place_formatted?: string;
};
type SuggestResponse = { suggestions?: SearchBoxSuggestion[] };
type RetrieveResponse = {
  features?: {
    geometry?: { coordinates?: unknown };
    properties?: { name?: string; place_formatted?: string; full_address?: string; feature_type?: string };
  }[];
};

export type SearchOptions = GeocodeOptions & {
  /** One per search session: the suggests and the retrieve that follows them are billed together. */
  sessionToken: string;
};

/**
 * Search Box suggest finds POIs by name (the v6 geocoder has none) but returns no coordinates;
 * pick one with retrievePlace. Landmarks and viewpoints rank before towns and addresses (the sort is stable, so Mapbox's order holds
 * within each group). If suggest fails, the v6 geocoder answers instead, with coordinates already in place.
 */
export async function searchPlaces(query: string, options: SearchOptions, fetchImpl: typeof fetch = fetch): Promise<SearchSuggestion[]> {
  if (isFakeExternal()) return fakeSearch(query);
  const proximity = options.proximity
    ? `&proximity=${options.proximity.lng.toFixed(6)},${options.proximity.lat.toFixed(6)}`
    : "";
  const cacheKey = `${query.toLowerCase()}|${proximity}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  const url =
    `${MAPBOX_BASE}/search/searchbox/v1/suggest?q=${encodeURIComponent(query)}` +
    `&session_token=${encodeURIComponent(options.sessionToken)}&limit=5${proximity}` +
    `&types=poi,address,place,locality,neighborhood&language=en&access_token=${encodeURIComponent(token())}`;
  let raw: SearchBoxSuggestion[] | null = null;
  try {
    const { ok, body } = await getJson<SuggestResponse>(url, fetchImpl, "Couldn't reach the place search service");
    if (ok && Array.isArray(body?.suggestions)) raw = body.suggestions;
  } catch (e) {
    if (!(e instanceof ExternalServiceError)) throw e;
  }
  if (!raw) {
    const places = await geocode(query, { proximity: options.proximity }, fetchImpl);
    // Not cached: a brief suggest outage must not hide landmarks for the whole TTL.
    return places.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng }));
  }
  const results = raw
    .filter((s) => s && typeof s.name === "string" && s.name && typeof s.mapbox_id === "string" && s.mapbox_id)
    .sort((a, b) => Number(a.feature_type !== "poi") - Number(b.feature_type !== "poi"))
    .map((s) => {
      const subtitle = [Array.isArray(s.poi_category) ? s.poi_category[0] : undefined, s.place_formatted].filter(Boolean).join(" · ");
      return { name: clampName(s.name!), ...(subtitle ? { subtitle } : {}), mapboxId: s.mapbox_id! };
    });
  searchCache.set(cacheKey, results);
  return results;
}

/** Coordinates for a picked suggestion, named like "Horseshoe Bend, Page, Arizona" so the stop reads well on its own. */
export async function retrievePlace(id: string, sessionToken: string, fetchImpl: typeof fetch = fetch): Promise<Place> {
  if (isFakeExternal()) {
    const fake = fakeRetrieve(id);
    if (!fake) throw new ExternalServiceError("Place lookup failed. Please try again.");
    return fake;
  }
  const cached = retrieveCache.get(id);
  if (cached) return cached;
  const url =
    `${MAPBOX_BASE}/search/searchbox/v1/retrieve/${encodeURIComponent(id)}` +
    `?session_token=${encodeURIComponent(sessionToken)}&access_token=${encodeURIComponent(token())}`;
  const { ok, body } = await getJson<RetrieveResponse>(url, fetchImpl, "Couldn't reach the place lookup service");
  const f = body?.features?.[0];
  const coords = f?.geometry?.coordinates;
  if (!ok || !f || !isLngLat(coords)) throw new ExternalServiceError("Place lookup failed. Please try again.");
  const { name, place_formatted: region, full_address: address, feature_type: type } = f.properties ?? {};
  const full = type === "address" && address ? address : [name, region].filter(Boolean).join(", ");
  const place = { name: clampName(full || coordsLabel({ lng: coords[0], lat: coords[1] })), lng: coords[0], lat: coords[1] };
  retrieveCache.set(id, place);
  return place;
}

/** Names a clicked spot; the returned coordinates are the clicked ones, not the feature's. */
export async function reverseGeocode(p: { lat: number; lng: number }, fetchImpl: typeof fetch = fetch): Promise<Place> {
  if (isFakeExternal()) return fakeReverseGeocode(p);
  const rKey = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const rCached = reverseCache.get(rKey);
  if (rCached) return rCached;
  const url =
    `${MAPBOX_BASE}/search/geocode/v6/reverse?longitude=${p.lng.toFixed(6)}&latitude=${p.lat.toFixed(6)}` +
    `&limit=1&access_token=${encodeURIComponent(token())}`;
  const { ok, body } = await getJson<GeocodeResponse>(url, fetchImpl, "Couldn't reach the place lookup service");
  if (!ok || !body) throw new ExternalServiceError("Place lookup failed. Please try again.");
  const f = body.features?.[0];
  const place = { name: pickName(f?.properties, coordsLabel(p)), lat: p.lat, lng: p.lng };
  reverseCache.set(rKey, place);
  return place;
}
