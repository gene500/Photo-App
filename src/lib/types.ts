// Shared DTO types used by API routes, server data access, and client components.

export type LngLat = [lng: number, lat: number];

export type Place = { name: string; lat: number; lng: number };

export type StopSource = "manual" | "suggested";

export type LightPref = "any" | "sunrise" | "golden" | "sunset";

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
  /** Light the stop is best shot in. */
  lightPref: LightPref;
  /** Minutes spent at the stop (0..480). */
  dwellMinutes: number;
};

export type Trip = {
  id: string;
  name: string;
  /** Calendar date, "YYYY-MM-DD". */
  plannedDate: string;
  /** ISO instant the trip leaves the first stop; null = sunrise at the first stop. */
  departAt: string | null;
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

/** A Wikipedia photo of a place (decorative; always credited). */
export type PlacePhoto = {
  /** https thumbnail (~480px wide) on a Wikimedia upload host. */
  url: string;
  /** Wikipedia article title. */
  title: string;
  pageUrl: string;
  credit: "Wikipedia";
};
