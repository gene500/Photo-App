import type { LngLat, Place, RouteResult } from "@/lib/types";
import { fakeDirections, fakeGeocode, isFakeExternal } from "./fake";

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
  if (!t) throw new ExternalServiceError("Mapbox is not configured (MAPBOX_TOKEN is missing)");
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

export async function getDirections(coords: LngLat[], fetchImpl: typeof fetch = fetch): Promise<RouteResult> {
  if (isFakeExternal()) return fakeDirections(coords);
  const path = coords.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
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
  return {
    geometry: route.geometry.coordinates,
    legs: route.legs.map((l) => ({ distance: l.distance, duration: l.duration })),
    distance: route.distance,
    duration: route.duration,
  };
}

type GeocodeResponse = {
  features?: {
    geometry: { coordinates: [number, number] };
    properties: { name?: string; full_address?: string };
  }[];
};

export async function geocode(query: string, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  if (isFakeExternal()) return fakeGeocode(query);
  const url =
    `${MAPBOX_BASE}/search/geocode/v6/forward?q=${encodeURIComponent(query)}` +
    `&limit=5&access_token=${encodeURIComponent(token())}`;
  const { ok, body } = await getJson<GeocodeResponse>(url, fetchImpl, "Couldn't reach the place search service");
  if (!ok || !body?.features) throw new ExternalServiceError("Place search failed. Please try again.");
  return body.features.map((f) => ({
    name: f.properties.full_address ?? f.properties.name ?? query,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}
