import type { Stop as StopRow, Trip as TripRow } from "@/generated/prisma/client";
import { utcToDateOnly } from "@/lib/dates";
import type { LightPref, PublicStop, PublicTrip, ShotItem, Stop, StopSource, Trip } from "@/lib/types";

export function toTripDto(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    plannedDate: utcToDateOnly(row.plannedDate),
    departAt: row.departAt ? row.departAt.toISOString() : null,
    shareToken: row.shareToken,
  };
}

const MAX_READ_ITEMS = 20;
const MAX_READ_TEXT = 120;

/** The checklist is stored as JSON text; anything unreadable degrades to an empty list, and an oversized one is capped (20 items, 120 chars each). */
export function parseShotChecklist(raw: string): ShotItem[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .flatMap((i) =>
        typeof i === "object" && i !== null && typeof i.text === "string" && typeof i.done === "boolean"
          ? [{ text: i.text.slice(0, MAX_READ_TEXT), done: i.done }]
          : [],
      )
      .slice(0, MAX_READ_ITEMS);
  } catch {
    return [];
  }
}

export function toStopDto(row: StopRow): Stop {
  return {
    id: row.id,
    tripId: row.tripId,
    order: row.order,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    notes: row.notes,
    source: row.source as StopSource,
    photoUrl: row.photoUrl,
    visited: row.visited,
    lightPref: row.lightPref as LightPref,
    dwellMinutes: row.dwellMinutes,
    shotNotes: row.shotNotes,
    shotChecklist: parseShotChecklist(row.shotChecklist),
  };
}

/**
 * The only mapper the public share page uses. It picks fields explicitly (never spreads a row), so a
 * column added later stays private until it is listed here. No ids, no userId, no photoUrl, no token.
 */
export function toPublicTripDto(row: TripRow & { stops: StopRow[] }): PublicTrip {
  const stops: PublicStop[] = [...row.stops]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      order: s.order,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      notes: s.notes,
      source: s.source as StopSource,
      visited: s.visited,
      lightPref: s.lightPref as LightPref,
      dwellMinutes: s.dwellMinutes,
      shotNotes: s.shotNotes,
      shotChecklist: parseShotChecklist(s.shotChecklist),
    }));
  return {
    name: row.name,
    plannedDate: utcToDateOnly(row.plannedDate),
    departAt: row.departAt ? row.departAt.toISOString() : null,
    stops,
  };
}
