import type { LightPref, LngLat, Place, PlacePhoto, RouteResult, Stop, StopPriority, Suggestion, Trip, TripSummary, WeatherForecast } from "./types";
import type { NewStopInput, StopPatch, TripCreateInput, TripPatch } from "./validation";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: isForm || init.body === undefined ? init.headers : { "Content-Type": "application/json" },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  signup: (email: string, password: string, guard: { formToken?: string; website?: string } = {}) =>
    request<{ user: { id: string; email: string } }>("/api/signup", send("POST", { email, password, ...guard })),
  signOutEverywhere: () => request<void>("/api/account/sessions", send("DELETE")),
  /** Permanently deletes the signed-in account and everything in it; the password confirms it. */
  changePassword: (currentPassword: string, newPassword: string) => request<void>("/api/account/password", send("POST", { currentPassword, newPassword })),
  deleteAccount: (proof: { password?: string; confirmEmail?: string }) => request<void>("/api/account", send("DELETE", proof)),
  listTrips: () => request<{ trips: TripSummary[] }>("/api/trips"),
  createTrip: (input: TripCreateInput) => request<{ trip: Trip }>("/api/trips", send("POST", input)),
  updateTrip: (id: string, patch: TripPatch) => request<{ trip: Trip }>(`/api/trips/${id}`, send("PATCH", patch)),
  deleteTrip: (id: string) => request<void>(`/api/trips/${id}`, send("DELETE")),
  createShare: (tripId: string) => request<{ shareToken: string }>(`/api/trips/${tripId}/share`, send("POST")),
  revokeShare: (tripId: string) => request<void>(`/api/trips/${tripId}/share`, send("DELETE")),
  addStop: (tripId: string, input: NewStopInput) =>
    request<{ stop: Stop }>(`/api/trips/${tripId}/stops`, send("POST", input)),
  updateStop: (id: string, patch: StopPatch) => request<{ stop: Stop }>(`/api/stops/${id}`, send("PATCH", patch)),
  deleteStop: (id: string) => request<void>(`/api/stops/${id}`, send("DELETE")),
  reorderStops: (tripId: string, stopIds: string[]) =>
    request<{ stops: Stop[] }>(`/api/trips/${tripId}/stops/order`, send("PUT", { stopIds })),
  uploadPhoto: (stopId: string, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return request<{ stop: Stop }>(`/api/stops/${stopId}/photo`, { method: "POST", body: form });
  },
  removePhoto: (stopId: string) => request<{ stop: Stop }>(`/api/stops/${stopId}/photo`, send("DELETE")),
  directions: (coordinates: LngLat[]) =>
    request<{ route: RouteResult }>("/api/directions", send("POST", { coordinates })),
  optimizeOrder: (coordinates: LngLat[], light?: { stops: { lightPref: LightPref; priority?: StopPriority; dwellMinutes: number }[]; plannedDate: string; departAt?: string }) =>
    request<{ order: number[]; departAt?: string | null; misses?: { stopIndex: number; minutes: number; priority?: StopPriority }[] }>(
      "/api/optimize",
      send("POST", { coordinates, ...light }),
    ),
  /** `enrich: false` answers as soon as places are found; popularity then arrives via `suggestionPopularity`. */
  suggestions: (route: LngLat[] | { around: LngLat; radiusKm?: number }, opts: { enrich?: boolean } = {}) =>
    request<{ suggestions: Suggestion[]; degraded?: boolean }>("/api/suggestions", send("POST", { ...(Array.isArray(route) ? { coordinates: route } : route), ...opts })),
  /** Photo-count popularity for up to 10 places; a null count means unknown. */
  suggestionPopularity: (places: { lat: number; lng: number; name?: string }[]) =>
    request<{ counts: (number | null)[]; notable?: (boolean | null)[] }>("/api/suggestions/popularity", send("POST", { places })),
  geocode: (q: string, proximity?: { lat: number; lng: number }) =>
    request<{ places: Place[] }>(
      `/api/geocode?q=${encodeURIComponent(q)}${proximity ? `&proximity=${proximity.lng.toFixed(6)},${proximity.lat.toFixed(6)}` : ""}`,
    ),
  reverseGeocode: (lat: number, lng: number) =>
    request<{ place: Place }>(`/api/reverse-geocode?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`),
  placePhoto: (p: { name: string; lat: number; lng: number }) =>
    request<{ photo: PlacePhoto | null }>(
      `/api/place-photo?lat=${p.lat.toFixed(6)}&lng=${p.lng.toFixed(6)}&name=${encodeURIComponent(p.name)}`,
    ),
  /** Weather for up to 10 places on one date, in the same order; unavailable ones come back as unavailable. */
  weatherBatch: (date: string, points: { lat: number; lng: number }[]) =>
    request<{ forecasts: WeatherForecast[] }>("/api/weather/batch", send("POST", { date, points })),
  weather: (p: { lat: number; lng: number; date: string }) =>
    request<{ forecast: WeatherForecast }>(`/api/weather?lat=${p.lat.toFixed(6)}&lng=${p.lng.toFixed(6)}&date=${p.date}`),
};
