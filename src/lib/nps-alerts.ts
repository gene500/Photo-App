import { haversineMeters } from "@/lib/geo";

export type NpsPark = { parkCode: string; name: string; lat: number; lng: number };
export type NpsAlert = { parkCode: string; title: string; category: string };

/** Park centres are points, so only a stop reasonably close to one is matched; parks are big, towns just outside are not. */
export const NPS_MATCH_RADIUS_M = 35_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Reads the `/parks` answer; rows without a code, name or usable coordinates are dropped. */
export function parseNpsParks(json: unknown): NpsPark[] {
  const data = isRecord(json) && Array.isArray(json.data) ? json.data : [];
  return data.flatMap((row): NpsPark[] => {
    if (!isRecord(row)) return [];
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (typeof row.parkCode !== "string" || !/^[a-z0-9]{3,10}$/i.test(row.parkCode) || typeof row.fullName !== "string") return [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    return [{ parkCode: row.parkCode.toLowerCase(), name: row.fullName, lat, lng }];
  });
}

/** Reads the `/alerts` answer. */
export function parseNpsAlerts(json: unknown): NpsAlert[] {
  const data = isRecord(json) && Array.isArray(json.data) ? json.data : [];
  return data.flatMap((row): NpsAlert[] => {
    if (!isRecord(row) || typeof row.parkCode !== "string" || typeof row.title !== "string" || !row.title.trim()) return [];
    return [{ parkCode: row.parkCode.toLowerCase(), title: row.title.trim(), category: typeof row.category === "string" ? row.category : "" }];
  });
}

export function nearestPark(parks: NpsPark[], lat: number, lng: number): NpsPark | null {
  let best: NpsPark | null = null;
  let bestD = NPS_MATCH_RADIUS_M;
  for (const p of parks) {
    const d = haversineMeters({ lat, lng }, { lat: p.lat, lng: p.lng });
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

const ROAD_WORDS = /\b(road|rd|highway|hwy|route|drive|pass|parkway|trail|trailhead|campground|entrance|bridge|tunnel|scenic)\b/i;
const CLOSED_WORDS = /\b(closed|closure|closures|closing|reopen|reopening|impassable)\b/i;
const MAX_TEXT = 110;

/**
 * "Park Closure" alerts are always reported. Other alerts (Caution, Danger, Information) only when the title is
 * about a road, trail or similar being closed. Anything else is ignored, so ordinary news does not become noise.
 */
export function classifyAlert(a: NpsAlert): "closed" | "alert" | null {
  if (/^park closure$/i.test(a.category)) return "closed";
  if (ROAD_WORDS.test(a.title) && CLOSED_WORDS.test(a.title)) return /^(caution|danger|information)$/i.test(a.category) ? "alert" : null;
  return null;
}

export const shortText = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1).trimEnd()}…` : s);

/** At most this many NPS notes per stop, "closed" first. */
export const MAX_NOTICES_PER_STOP = 3;
