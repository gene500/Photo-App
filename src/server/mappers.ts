import type { Stop as StopRow, Trip as TripRow } from "@/generated/prisma/client";
import { utcToDateOnly } from "@/lib/dates";
import type { LightPref, ShotItem, Stop, StopSource, Trip } from "@/lib/types";

export function toTripDto(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    plannedDate: utcToDateOnly(row.plannedDate),
    departAt: row.departAt ? row.departAt.toISOString() : null,
  };
}

/** The checklist is stored as JSON text; anything unreadable degrades to an empty list. */
export function parseShotChecklist(raw: string): ShotItem[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.flatMap((i) =>
      typeof i === "object" && i !== null && typeof i.text === "string" && typeof i.done === "boolean"
        ? [{ text: i.text, done: i.done }]
        : [],
    );
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
