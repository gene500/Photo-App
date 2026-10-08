// Offline read-only copies of trips, kept in localStorage on this device.
// Private trip data lives here, so: no tokens or emails are ever stored (the share token is stripped),
// copies are wiped on sign-out and when a different user signs in, and everything is best-effort
// (storage can be missing, full or blocked; nothing here ever throws).
import type { TripWithStops } from "@/lib/types";

const PREFIX = "rtpp.offline.";
const INDEX_KEY = `${PREFIX}index`;
const OWNER_KEY = `${PREFIX}owner`;
const tripKey = (id: string) => `${PREFIX}trip.${id}`;

/** Only the most recent trips are kept. */
export const MAX_COPIES = 20;

export type TripCopySummary = { id: string; name: string; plannedDate: string; savedAt: string; stopCount: number };
export type TripCopy = { savedAt: string; trip: TripWithStops };

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readIndex(s: Storage): TripCopySummary[] {
  try {
    const parsed: unknown = JSON.parse(s.getItem(INDEX_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is TripCopySummary => !!e && typeof e.id === "string" && typeof e.name === "string" && typeof e.plannedDate === "string" && typeof e.savedAt === "string" && typeof e.stopCount === "number",
    );
  } catch {
    return [];
  }
}

/** The copy never carries the share token, and uploaded photos (private URLs) are not needed offline. */
function sanitize(trip: TripWithStops): TripWithStops {
  return { ...trip, shareToken: null, stops: trip.stops.map((st) => ({ ...st, photoUrl: null })) };
}

/** Saves (or refreshes) the copy of a trip and keeps the 20 most recent. Returns false when nothing could be stored. */
export function saveTripCopy(trip: TripWithStops, now: Date = new Date()): boolean {
  const s = storage();
  if (!s) return false;
  const savedAt = now.toISOString();
  const payload = JSON.stringify({ savedAt, trip: sanitize(trip) } satisfies TripCopy);
  const entry: TripCopySummary = { id: trip.id, name: trip.name, plannedDate: trip.plannedDate, savedAt, stopCount: trip.stops.length };
  let index = [entry, ...readIndex(s).filter((e) => e.id !== trip.id)].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const evict = (list: TripCopySummary[]) => {
    for (const e of list) s.removeItem(tripKey(e.id));
  };
  evict(index.slice(MAX_COPIES));
  index = index.slice(0, MAX_COPIES);
  // A full quota is handled quietly: drop the oldest other copies one by one and retry; give up if even that fails.
  for (;;) {
    try {
      s.setItem(tripKey(trip.id), payload);
      s.setItem(INDEX_KEY, JSON.stringify(index));
      return true;
    } catch {
      const oldest = index.length > 1 ? index[index.length - 1] : null;
      if (!oldest || oldest.id === trip.id) return false;
      s.removeItem(tripKey(oldest.id));
      index = index.slice(0, -1);
    }
  }
}

/** Saved trips, most recently saved first. */
export function listTripCopies(): TripCopySummary[] {
  const s = storage();
  return s ? readIndex(s) : [];
}

export function loadTripCopy(id: string): TripCopy | null {
  const s = storage();
  if (!s) return null;
  try {
    const parsed: unknown = JSON.parse(s.getItem(tripKey(id)) ?? "null");
    const c = parsed as TripCopy | null;
    if (!c || typeof c.savedAt !== "string" || !c.trip || typeof c.trip.id !== "string" || !Array.isArray(c.trip.stops)) return null;
    return c;
  } catch {
    return null;
  }
}

/** Removes every offline copy and the owner mark (sign-out, a different user, the settings button). */
export function clearAllCopies(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    /* storage blocked: nothing more to do */
  }
}

/** Records whose copies these are; if a different user is signed in now, the old user's copies are wiped first. */
export function claimOwner(userId: string): void {
  const s = storage();
  if (!s) return;
  try {
    const owner = s.getItem(OWNER_KEY);
    if (owner !== null && owner !== userId) clearAllCopies();
    else if (owner === null && readIndex(s).length > 0) clearAllCopies(); // copies of unknown origin
    s.setItem(OWNER_KEY, userId);
  } catch {
    /* ignore */
  }
}
