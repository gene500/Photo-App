// Plain limits shared by the server schemas (validation.ts) and the browser. Kept free of zod so client code can import
// these values without pulling the schema library into its bundle.

export const MAX_ROUTE_WAYPOINTS = 25; // Mapbox Directions driving profile limit
export const MAX_DWELL_MINUTES = 480;

/** Longest stop name; search results and suggestions are cut to this so any of them can be added as a stop. */
export const MAX_STOP_NAME = 200;

/** Longest trip name. */
export const MAX_TRIP_NAME = 120;

/** Longest stop notes text. */
export const MAX_STOP_NOTES = 5000;

export const inYearRange = (ms: number) => {
  const y = new Date(ms).getUTCFullYear();
  return y >= 1970 && y <= 2200;
};

export const MAX_SHOT_ITEMS = 20;
export const MAX_SHOT_TEXT = 120;
export const MAX_SHOT_NOTES = 2000;

/** Most places whose weather one batch request may ask for. */
export const WEATHER_BATCH_MAX = 10;

/** Coast to coast with detours is ~6,000 km; a longer route is not a real driving route (and would read most of the map data), so the suggestions search refuses it. */
export const MAX_SUGGESTIONS_ROUTE_KM = 6_000;

/** Fewest characters a place search (geocode, locate) accepts; the server counts code points (an emoji is one), so the browser must too. */
export const MIN_SEARCH_CHARS = 2;
export const longEnoughToSearch = (text: string) => [...text.trim()].length >= MIN_SEARCH_CHARS;
