// The text of the PDF itinerary, built from a trip's stops with the same formatting the screen uses.

import { hasContent } from "./text";
import { formatClock } from "./best-time";
import { exportBaseName } from "./export";
import { formatDistance, formatDuration } from "./format";
import { formatHikeDistance } from "./hike";
import { lightLabel } from "./light-windows";
import type { DistanceUnit, TimeFormat } from "./settings";
import { PRIORITY_LABEL, stopColor } from "./stop-style";
import type { LightPref, LngLat, Stop, StopPriority } from "./types";
import { hasWalkLength, walkMinutes } from "./walk-time";
import type { WeatherLine } from "./use-weather";
import { weatherAriaLabel } from "./weather";

export type ItineraryStopSource = {
  name: string;
  lat: number;
  lng: number;
  notes: string | null;
  shotNotes?: string | null;
  lightPref: LightPref;
  /** When the subject is reached (lot arrival plus the walk); the time light is judged at. */
  arrival: Date | null;
  /** When the car reaches the lot; printed as "Park ~5:17 AM" only when there is a walk (otherwise it equals `arrival`). */
  lotArrival?: Date | null;
  /** Colours the numbered disc like the app's dot; omitted means a manual, unvisited stop. */
  source?: Stop["source"];
  visited?: boolean;
  /** Printed after the light ("Best at sunset · Must-have") for a stop with a light preference; omitted or normal prints nothing. */
  priority?: StopPriority;
  /** Where the car stops for this stop's hike; only the name is printed (with `walkMeters`). */
  access?: { name: string | null; kind?: "lot" | "road-end"; trail?: LngLat[] | null } | null;
  /** Walk from the access point to the stop; when unknown the line says where to park but not how far to walk. */
  walkMeters?: number | null;
};

/** One stop as printed; `index` is 1-based and null fields are left out of the PDF. */
export type ItineraryStop = {
  index: number;
  name: string;
  /** Hex colour of the numbered disc, from stopColor. */
  color?: string;
  arrival: string;
  bestLight: string | null;
  /** "Park at North lot, walk 1.2 mi to Name", or null without an access point. */
  parkLine?: string | null;
  weather: string | null;
  notes: string | null;
};

export type ItineraryInput = {
  tripName: string;
  dateLine: string;
  startLine: string | null;
  routeLine: string | null;
  /** Caveat printed under the route line (for example that times are estimates). */
  note: string | null;
  stops: ItineraryStop[];
};

type WeatherSource = Pick<WeatherLine, "text" | "label" | "warning">;

function weatherText(w: WeatherSource | null | undefined): string | null {
  if (!w) return null;
  const spoken = weatherAriaLabel(w);
  const words = spoken.charAt(0).toUpperCase() + spoken.slice(1);
  return w.warning ? `${words}. ${w.warning}` : words;
}

/**
 * "Park at North lot, walk 1.2 mi (~25 min) to <stop>" (the walk part only when its length is known; the minutes are the flat estimate of
 * `walkMinutes`, one way); null with no access point. `parkAt` (a clock text) goes after the lot name, "Park at North lot ~5:17 AM, walk ...",
 * and only when there is a walk.
 */
export function parkText(s: Pick<ItineraryStopSource, "name" | "access" | "walkMeters">, unit: DistanceUnit, parkAt?: string | null): string | null {
  if (!s.access) return null;
  const name = s.access.name && hasContent(s.access.name) ? s.access.name.trim() : "the parking lot";
  const minutes = walkMinutes(s.walkMeters);
  // A road end with no mapped trail says so: the walk is a straight-line estimate.
  const note = s.access.kind === "road-end" && !s.access.trail ? " (no mapped trail)" : "";
  if (!hasWalkLength(s.walkMeters) || typeof s.walkMeters !== "number") return `Park at ${name}${note}`;
  return `Park at ${name}${parkAt && minutes > 0 ? ` ~${parkAt}` : ""}, walk ${formatHikeDistance(s.walkMeters, unit)} (~${minutes} min) to ${s.name}${note}`;
}

export function buildItinerary(a: {
  tripName: string;
  plannedDate: string;
  departAt: Date | null;
  totalDistanceM: number | null;
  totalDurationS: number | null;
  stops: ItineraryStopSource[];
  weather?: (WeatherSource | null)[];
  timeFormat: TimeFormat;
  distanceUnit: DistanceUnit;
  note?: string | null;
}): ItineraryInput {
  const clock = (d: Date) => formatClock(d, undefined, a.timeFormat);
  return {
    tripName: a.tripName,
    dateLine: `Planned for ${a.plannedDate}`,
    startLine: a.departAt ? `Starts ${clock(a.departAt)}` : null,
    routeLine:
      a.totalDistanceM !== null && a.totalDurationS !== null
        ? `${formatDistance(a.totalDistanceM, a.distanceUnit)} · ${formatDuration(a.totalDurationS)}`
        : null,
    note: a.note ?? null,
    stops: a.stops.map((s, i) => ({
      index: i + 1,
      name: s.visited ? `${s.name} (visited)` : s.name,
      color: stopColor({ source: s.source ?? "manual", visited: s.visited ?? false }),
      arrival: s.arrival ? clock(s.arrival) : "Time not set",
      bestLight: s.lightPref === "any" ? null : `Best at ${lightLabel(s.lightPref).toLowerCase()}${s.priority && s.priority !== "normal" ? ` · ${PRIORITY_LABEL[s.priority]}` : ""}`,
      parkLine: parkText(s, a.distanceUnit, s.lotArrival ? clock(s.lotArrival) : null),
      weather: weatherText(a.weather?.[i]),
      notes: [s.notes, s.shotNotes].map((t) => t?.trim()).filter(Boolean).join("\n\n") || null,
    })),
  };
}

/** `<slug>-itinerary.pdf`; falls back to `trip-<date>[-hash]` like the GPX name when the name has nothing usable. */
export function itineraryFileName(tripName: string, date?: string): string {
  return `${exportBaseName(tripName, date)}-itinerary.pdf`;
}
