/**
 * Monthly free allowances of the paid providers, and the share of them this app is allowed to use. Each entry says where
 * the number came from and when it was checked; `confirmed: false` means it is a placeholder until the owner checks the
 * provider's dashboard.
 */
export type BudgetProduct =
  | "mapbox-geocoding"
  | "mapbox-directions"
  | "mapbox-matrix"
  | "mapbox-map-load"
  | "mapbox-static-image"
  | "flickr";

export type BudgetInfo = { label: string; allowance: number | null; source: string; checked: string; confirmed: boolean };

const MAPBOX_SOURCE = "https://docs.mapbox.com/accounts/guides/signup/";
const CHECKED = "2026-11-23";

export const BUDGETS: Record<BudgetProduct, BudgetInfo> = {
  "mapbox-geocoding": { label: "Mapbox place search", allowance: 10_000, source: MAPBOX_SOURCE, checked: CHECKED, confirmed: false },
  "mapbox-directions": { label: "Mapbox directions", allowance: 10_000, source: MAPBOX_SOURCE, checked: CHECKED, confirmed: true },
  "mapbox-matrix": { label: "Mapbox travel-time matrix", allowance: 10_000, source: MAPBOX_SOURCE, checked: CHECKED, confirmed: true },
  "mapbox-map-load": { label: "Mapbox map loads", allowance: 5_000, source: MAPBOX_SOURCE, checked: CHECKED, confirmed: true },
  "mapbox-static-image": { label: "Mapbox static images", allowance: 10_000, source: MAPBOX_SOURCE, checked: CHECKED, confirmed: false },
  flickr: { label: "Flickr", allowance: null, source: "No monthly cap; the hourly flickr-app limit applies.", checked: CHECKED, confirmed: true },
};

/** The app stops at this share of each allowance. */
export const BUDGET_FRACTION = 0.8;
/** One user may spend this share of the capped amount, per product per month. */
export const USER_SHARE_FRACTION = 0.3;
