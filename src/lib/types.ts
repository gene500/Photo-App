// Shared DTO types used by API routes, server data access, and client components.

export type LngLat = [lng: number, lat: number];

export type Place = { name: string; lat: number; lng: number };

export type StopSource = "manual" | "suggested";

export type LightPref = "any" | "sunrise" | "golden" | "sunset";

export type ShotItem = { text: string; done: boolean };

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
  /** Free-text notes on the shots wanted here (max 2000 chars). */
  shotNotes: string | null;
  /** Shots to get at this stop (up to 20). */
  shotChecklist: ShotItem[];
};

export type Trip = {
  id: string;
  name: string;
  /** Calendar date, "YYYY-MM-DD". */
  plannedDate: string;
  /** ISO instant the trip leaves the first stop; null = sunrise at the first stop. */
  departAt: string | null;
  /** Read-only share token; only ever sent to the trip's owner. */
  shareToken: string | null;
};

/** One stop as shown on the public share page: no ids, no uploaded photo. */
export type PublicStop = Pick<
  Stop,
  "order" | "name" | "lat" | "lng" | "notes" | "source" | "visited" | "lightPref" | "dwellMinutes" | "shotNotes" | "shotChecklist"
>;

/** The sanitized, read-only view of a shared trip. Nothing here identifies or can modify the owner's data. */
export type PublicTrip = {
  name: string;
  plannedDate: string;
  departAt: string | null;
  stops: PublicStop[];
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
  /** Photos taken nearby (Flickr total when a key is set, else Commons files, capped at 50); used to rank and to caption. */
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

/** One forecast hour. `time` is the location's LOCAL wall-clock time ("2026-07-01T19:00"), as Open-Meteo reports it. */
export type WeatherHour = { time: string; cloudPct: number | null; rainPct: number | null; tempC: number | null };
export type WeatherForecast =
  | { available: true; utcOffsetSeconds: number; hours: WeatherHour[] }
  | { available: false; reason: "out_of_range" | "unavailable" };
