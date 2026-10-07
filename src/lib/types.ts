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
  /** Flickr photos taken nearby (only when a Flickr key is configured); used to rank and to caption. */
  popularity?: number;
};

/** A photo of a place from Flickr, Wikimedia Commons or Wikipedia (decorative; always credited). */
export type PlacePhoto = {
  /** https thumbnail (~480px wide) on an allow-listed image host. */
  url: string;
  /** Article or file title. */
  title: string;
  /** Page the photo came from (article, Commons file page or Flickr photo page). */
  pageUrl: string;
  /** Display text, e.g. "Photo: Jane Doe via Flickr (CC BY 2.0)". Plain text, never HTML. */
  credit: string;
};
