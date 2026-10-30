import type { LightPref, LngLat, Place, PlacePhoto, RouteResult, SearchSuggestion, Stop, PlaceNotice, StopPriority, Suggestion, Trip, TripSummary, TripWithStops, WeatherForecast } from "./types";
import { shapes } from "./api-shapes";
import { isHike, type Hike } from "./hike";
import type { NewStopInput, StopPatch, TripCreateInput, TripPatch } from "./validation";

export class ApiError extends Error {
  readonly status: number;
  /** Machine-readable cause when the server gives one (e.g. "reauth"). */
  readonly reason?: string;
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
  }
}

/** Replaces lone UTF-16 surrogates with U+FFFD: `encodeURIComponent` throws a URIError on them (typed or pasted text can carry one). */
function wellFormed(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      out += text[i] + text[++i];
    } else {
      out += c >= 0xd800 && c <= 0xdfff ? "\ufffd" : text[i];
    }
  }
  return out;
}
const encodeQuery = (text: string) => encodeURIComponent(wellFormed(text));

/** How long a request may take before it is given up on, so buttons never stay disabled forever. */
export const DEFAULT_TIMEOUT_MS = 20_000;
/** Optimize (a big Matrix call) and photo uploads legitimately take longer. */
export const LONG_TIMEOUT_MS = 60_000;

const TIMEOUT_MESSAGE = "The server is taking too long to answer. Try again.";
const SESSION_EXPIRED = "Your session has expired. Log in again to keep working.";

/** A readable message when the server's answer carries none (an HTML or empty error page, for example). */
function fallbackMessage(status: number): string {
  if (status === 401) return SESSION_EXPIRED;
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  return `Request failed (${status})`;
}

const BAD_ANSWER = "The server sent an answer the app could not read. Try again.";

/**
 * `check` validates the body of a successful answer (a wrong shape is an ApiError, never a raw TypeError later);
 * `check: "empty"` is for calls that answer 204 with no body: a 200 with a body (a captive portal page) is not a success.
 */
async function request<T>(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS, check?: ((body: unknown) => boolean) | "empty"): Promise<T> {
  const isForm = init.body instanceof FormData;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: isForm || init.body === undefined ? init.headers : { "Content-Type": "application/json" },
      });
    } catch (e) {
      if (timedOut) throw new ApiError(0, TIMEOUT_MESSAGE);
      // fetch rejects with a bare TypeError ("Failed to fetch") when offline or the server is unreachable.
      if (e instanceof TypeError) throw new ApiError(0, "You're offline or the server can't be reached. Try again.");
      throw e;
    }
    if (res.status === 204) return undefined as T;
    if (check === "empty" && res.ok) throw new ApiError(502, BAD_ANSWER);
    const body = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
    if (timedOut) throw new ApiError(0, TIMEOUT_MESSAGE);
    if (!res.ok) throw new ApiError(res.status, (res.status === 401 ? SESSION_EXPIRED : body?.error) ?? fallbackMessage(res.status), body?.reason);
    if (typeof check === "function" && !check(body)) throw new ApiError(502, BAD_ANSWER);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
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
  listTrips: () => request<{ trips: TripSummary[] }>("/api/trips", {}, DEFAULT_TIMEOUT_MS, shapes.tripList),
  createTrip: (input: TripCreateInput) => request<{ trip: Trip }>("/api/trips", send("POST", input), DEFAULT_TIMEOUT_MS, shapes.trip),
  updateTrip: (id: string, patch: TripPatch) => request<{ trip: Trip }>(`/api/trips/${id}`, send("PATCH", patch), DEFAULT_TIMEOUT_MS, shapes.trip),
  getTrip: (id: string) => request<{ trip: TripWithStops }>(`/api/trips/${id}`, {}, DEFAULT_TIMEOUT_MS, shapes.tripWithStops),
  deleteTrip: (id: string) => request<void>(`/api/trips/${id}`, send("DELETE"), DEFAULT_TIMEOUT_MS, "empty"),
  createShare: (tripId: string) => request<{ shareToken: string }>(`/api/trips/${tripId}/share`, send("POST"), DEFAULT_TIMEOUT_MS, shapes.shareToken),
  revokeShare: (tripId: string) => request<void>(`/api/trips/${tripId}/share`, send("DELETE"), DEFAULT_TIMEOUT_MS, "empty"),
  addStop: (tripId: string, input: NewStopInput) =>
    request<{ stop: Stop }>(`/api/trips/${tripId}/stops`, send("POST", input), DEFAULT_TIMEOUT_MS, shapes.stop),
  updateStop: (id: string, patch: StopPatch) => request<{ stop: Stop; /** Other stops whose visited flag changed with this one. */ stops?: Stop[] }>(`/api/stops/${id}`, send("PATCH", patch), DEFAULT_TIMEOUT_MS, shapes.stop),
  deleteStop: (id: string) => request<void>(`/api/stops/${id}`, send("DELETE"), DEFAULT_TIMEOUT_MS, "empty"),
  reorderStops: (tripId: string, stopIds: string[]) =>
    request<{ stops: Stop[] }>(`/api/trips/${tripId}/stops/order`, send("PUT", { stopIds }), DEFAULT_TIMEOUT_MS, shapes.stops),
  uploadPhoto: (stopId: string, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return request<{ stop: Stop }>(`/api/stops/${stopId}/photo`, { method: "POST", body: form }, LONG_TIMEOUT_MS, shapes.stop);
  },
  removePhoto: (stopId: string) => request<{ stop: Stop }>(`/api/stops/${stopId}/photo`, send("DELETE"), DEFAULT_TIMEOUT_MS, shapes.stop),
  directions: (coordinates: LngLat[]) =>
    request<{ route: RouteResult }>("/api/directions", send("POST", { coordinates }), DEFAULT_TIMEOUT_MS, shapes.route),
  optimizeOrder: (coordinates: LngLat[], light?: { stops: { lightPref: LightPref; priority?: StopPriority; dwellMinutes: number }[]; plannedDate: string; departAt?: string; focus?: "priority" | "time"; fixDeparture?: boolean; origin?: { lat: number; lng: number } }) =>
    request<{ order: number[]; complete?: boolean; departAt?: string | null; misses?: { stopIndex: number; minutes: number; priority?: StopPriority }[]; dark?: { stopIndex: number; minutes: number; priority?: StopPriority }[]; polar?: number[]; notices?: PlaceNotice[] }>(
      "/api/optimize",
      send("POST", { coordinates, ...light }),
      LONG_TIMEOUT_MS,
      shapes.order,
    ),
  /** The server may take about a minute outside the US, so this uses the long timeout. `enrich: false` answers as soon as places are found; popularity then arrives via `suggestionPopularity`. */
  suggestions: (route: LngLat[] | { around: LngLat; radiusKm?: number }, opts: { enrich?: boolean } = {}) =>
    request<{ suggestions: Suggestion[]; degraded?: boolean }>("/api/suggestions", send("POST", { ...(Array.isArray(route) ? { coordinates: route } : route), ...opts }), LONG_TIMEOUT_MS, shapes.suggestions),
  /** Photo-count popularity for up to 10 places; a null count means unknown. */
  suggestionPopularity: (places: { lat: number; lng: number; name?: string }[]) =>
    request<{ counts: (number | null)[]; notable?: (boolean | null)[] }>("/api/suggestions/popularity", send("POST", { places })),
  /** `session` groups the suggests and the retrieve of one search (Mapbox bills them together). */
  geocode: (q: string, session: string, proximity?: { lat: number; lng: number }) =>
    request<{ suggestions: SearchSuggestion[] }>(
      `/api/geocode?q=${encodeQuery(q)}&session=${session}${proximity ? `&proximity=${proximity.lng.toFixed(6)},${proximity.lat.toFixed(6)}` : ""}`,
      {},
      DEFAULT_TIMEOUT_MS,
      shapes.suggestions,
    ),
  retrievePlace: (id: string, session: string) =>
    request<{ place: Place }>(`/api/geocode/retrieve?id=${encodeQuery(id)}&session=${session}`, {}, DEFAULT_TIMEOUT_MS, shapes.place),
  reverseGeocode: (lat: number, lng: number) =>
    request<{ place: Place }>(`/api/reverse-geocode?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, {}, DEFAULT_TIMEOUT_MS, shapes.place),
  /** Where a trip name points (a city, park region or state), or null. */
  locate: (q: string) =>
    request<{ area: { lat: number; lng: number; bbox?: [number, number, number, number] } | null; landmark?: { name: string; lat: number; lng: number } | null }>(`/api/locate?q=${encodeQuery(q)}`),
  placePhoto: (p: { name: string; lat: number; lng: number }) =>
    request<{ photo: PlacePhoto | null }>(
      `/api/place-photo?lat=${p.lat.toFixed(6)}&lng=${p.lng.toFixed(6)}&name=${encodeQuery(p.name)}`,
    ),
  /** Weather for up to 10 places on one date, in the same order; unavailable ones come back as unavailable. */
  weatherBatch: (date: string, points: { lat: number; lng: number }[]) =>
    request<{ forecasts: WeatherForecast[] }>("/api/weather/batch", send("POST", { date, points })),
  /** The walk to a place from the nearest trailhead, or null when there is none. Decorative: callers swallow failures. */
  hike: (p: { lat: number; lng: number }, signal?: AbortSignal) =>
    request<{ hike: Hike | null }>(`/api/hike?lat=${p.lat.toFixed(6)}&lng=${p.lng.toFixed(6)}`, { signal }, DEFAULT_TIMEOUT_MS, (b) => {
      const h = (b as { hike?: unknown } | null)?.hike;
      return h === null || isHike(h);
    }),
  weather: (p: { lat: number; lng: number; date: string }) =>
    request<{ forecast: WeatherForecast }>(`/api/weather?lat=${p.lat.toFixed(6)}&lng=${p.lng.toFixed(6)}&date=${p.date}`),
};
