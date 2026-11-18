import { isNum } from "./guards";

// The walk from a parking lot to the subject, as time. One flat estimate used by the schedule, the light checks, Optimize
// and every itinerary text, so they cannot disagree.

/** Longest one-way walk counted (5 hours); the lookup itself never saves more than 5 km. Optimize's request schema uses the same bound. */
export const MAX_WALK_MINUTES = 300;

/** One-way minutes for a walk of `meters` at 4 km/h on the flat (it ignores elevation, surface and rests, so a steep trail takes longer), rounded up to the next 5; 0 when the walk is unknown, zero or not a finite number. */
export function walkMinutes(meters: number | null | undefined): number {
  if (!isNum(meters) || meters <= 0) return 0;
  // meters * 60 / 4000 (not meters / 66.67): a walk of exactly 1000 m is exactly 15 minutes, not 15.000000000000002.
  return Math.min(MAX_WALK_MINUTES, Math.ceil(((meters * 60) / 4000) / 5) * 5);
}

/** A walk in minutes as milliseconds (0 when missing or not finite). */
export function walkMs(minutes: number | null | undefined): number {
  return isNum(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

/** One-way walk minutes of a stop with a saved lot (0 without one or without a known walk). */
export function stopWalkMinutes(s: { access?: { walkMeters?: number | null } | null }): number {
  return walkMinutes(s.access?.walkMeters);
}

/** True when a walk length is known and positive (the park text then prints "walk ..."); the one check parkText and the My trip row share. */
export function hasWalkLength(meters: number | null | undefined): boolean {
  return isNum(meters) && meters > 0;
}
