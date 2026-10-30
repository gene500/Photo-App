// The text of the PDF itinerary, built from a trip's stops with the same formatting the screen uses.

import { formatClock } from "./best-time";
import { exportBaseName } from "./export";
import { formatDistance, formatDuration } from "./format";
import { lightLabel } from "./light-windows";
import type { DistanceUnit, TimeFormat } from "./settings";
import { stopColor } from "./stop-style";
import type { LightPref, Stop } from "./types";
import type { WeatherLine } from "./use-weather";
import { weatherAriaLabel } from "./weather";

export type ItineraryStopSource = {
  name: string;
  lat: number;
  lng: number;
  notes: string | null;
  shotNotes?: string | null;
  lightPref: LightPref;
  arrival: Date | null;
  /** Colours the numbered disc like the app's dot; omitted means a manual, unvisited stop. */
  source?: Stop["source"];
  visited?: boolean;
};

/** One stop as printed; `index` is 1-based and null fields are left out of the PDF. */
export type ItineraryStop = {
  index: number;
  name: string;
  /** Hex colour of the numbered disc, from stopColor. */
  color?: string;
  arrival: string;
  bestLight: string | null;
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
      name: s.name,
      color: stopColor({ source: s.source ?? "manual", visited: s.visited ?? false }),
      arrival: s.arrival ? clock(s.arrival) : "Time not set",
      bestLight: s.lightPref === "any" ? null : `Best at ${lightLabel(s.lightPref).toLowerCase()}`,
      weather: weatherText(a.weather?.[i]),
      notes: [s.notes, s.shotNotes].map((t) => t?.trim()).filter(Boolean).join("\n\n") || null,
    })),
  };
}

/** `<slug>-itinerary.pdf`; falls back to `trip-<date>[-hash]` like the GPX name when the name has nothing usable. */
export function itineraryFileName(tripName: string, date?: string): string {
  return `${exportBaseName(tripName, date)}-itinerary.pdf`;
}
