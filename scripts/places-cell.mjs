// Must stay identical to cellOf in src/server/suggestions/places-grid.ts (a test checks this).
// Longitude 180 wraps to column 0 (with -180), the column every search looks it up in.
export function cellOf(lat, lng) {
  return Math.floor((lat + 90) / 0.1) * 10000 + (((Math.floor((lng + 180) / 0.1) % 3600) + 3600) % 3600);
}
