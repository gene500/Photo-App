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
