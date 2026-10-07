import type { LngLat, Place, RouteResult, Stop, Suggestion, Trip, TripSummary } from "./types";
import type { NewStopInput, StopPatch, TripInput, TripPatch } from "./validation";

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
  signup: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/signup", send("POST", { email, password })),
  listTrips: () => request<{ trips: TripSummary[] }>("/api/trips"),
  createTrip: (input: TripInput) => request<{ trip: Trip }>("/api/trips", send("POST", input)),
  updateTrip: (id: string, patch: TripPatch) => request<{ trip: Trip }>(`/api/trips/${id}`, send("PATCH", patch)),
  deleteTrip: (id: string) => request<void>(`/api/trips/${id}`, send("DELETE")),
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
  suggestions: (coordinates: LngLat[]) =>
    request<{ suggestions: Suggestion[] }>("/api/suggestions", send("POST", { coordinates })),
  geocode: (q: string, proximity?: { lat: number; lng: number }) =>
    request<{ places: Place[] }>(
      `/api/geocode?q=${encodeURIComponent(q)}${proximity ? `&proximity=${proximity.lng},${proximity.lat}` : ""}`,
    ),
  reverseGeocode: (lat: number, lng: number) =>
    request<{ place: Place }>(`/api/reverse-geocode?lat=${lat}&lng=${lng}`),
};
