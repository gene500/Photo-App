// Must stay identical to cellOf in src/server/suggestions/places-grid.ts (a test checks this).
export function cellOf(lat, lng) {
  return Math.floor((lat + 90) / 0.1) * 10000 + Math.floor((lng + 180) / 0.1);
}
