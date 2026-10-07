// Shared DTO types used by API routes, server data access, and client components.

export type LngLat = [lng: number, lat: number];

export type Place = { name: string; lat: number; lng: number };

export type StopSource = "manual" | "suggested";

export type Stop = {
  id: string;
  tripId: string;
  order: number;
  name: string;
  lat: number;
  lng: number;
  notes: string | null;
  source: StopSource;
  photoUrl: string | null;
  visited: boolean;
};

export type Trip = {
  id: string;
  name: string;
  /** Calendar date, "YYYY-MM-DD". */
  plannedDate: string;
};

export type TripWithStops = Trip & { stops: Stop[] };

export type TripSummary = Trip & { stopCount: number; updatedAt: string };

export type RouteLeg = { distance: number; duration: number };

export type RouteResult = {
  /** Full route line as [lng, lat] pairs. */
  geometry: LngLat[];
  /** One leg per consecutive stop pair: stop1 -> stop2 -> ... */
  legs: RouteLeg[];
  /** Meters. */
  distance: number;
  /** Seconds. */
  duration: number;
};

export type SuggestionKind = "viewpoint" | "peak" | "attraction";

export type Suggestion = {
  /** e.g. "node/123" or "way/456" */
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  kind: SuggestionKind;
};
