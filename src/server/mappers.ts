import type { Stop as StopRow, Trip as TripRow } from "@/generated/prisma/client";
import { utcToDateOnly } from "@/lib/dates";
import type { Stop, StopSource, Trip } from "@/lib/types";

export function toTripDto(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    plannedDate: utcToDateOnly(row.plannedDate),
  };
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
  };
}
