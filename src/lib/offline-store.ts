// Offline read-only copies of trips, kept in localStorage on this device.
// Private trip data lives here, so: no tokens or emails are ever stored (the share token is stripped),
// copies are wiped on sign-out and when a different user signs in, and everything is best-effort
// (storage can be missing, full or blocked; nothing here ever throws).
import { isDateOnly } from "@/lib/dates";
import type { ShotItem, Stop, TripWithStops } from "@/lib/types";

const PREFIX = "rtpp.offline.";
const INDEX_KEY = `${PREFIX}index`;
const OWNER_KEY = `${PREFIX}owner`;
// Written (and removed again by the clear that follows) on sign-out so other tabs get a storage event telling them to stop saving.
const SIGNED_OUT_KEY = `${PREFIX}signedout`;
const tripKey = (id: string) => `${PREFIX}trip.${id}`;

/** Only the most recent trips are kept. */
export const MAX_COPIES = 20;

export type TripCopySummary = { id: string; name: string; plannedDate: string; savedAt: string; stopCount: number };
export type TripCopy = { savedAt: string; trip: TripWithStops };

// Sign-out switches saving off for the rest of this page's life: a debounced save that is still pending (or an
// in-flight autosave) must not re-create a copy after clearAllCopies() ran during the async signOut. Login re-enables it.
let savingDisabled = false;
/** True when saving was switched off only because another tab signed out (this tab did not sign out itself). */
let disabledByOtherTab = false;
/** The user this tab last claimed the copies for; another tab signing back in as the same user lets this tab save again. */
let knownOwner: string | null = null;
const disableListeners = new Set<() => void>();
const enableListeners = new Set<() => void>();

export function disableOfflineSaving(): void {
  savingDisabled = true;
  disabledByOtherTab = false;
  disableListeners.forEach((cb) => cb());
  try {
    storage()?.setItem(SIGNED_OUT_KEY, "1");
  } catch {
    /* other tabs just keep saving until their next reload */
  }
}
export function enableOfflineSaving(): void {
  savingDisabled = false;
  disabledByOtherTab = false;
  enableListeners.forEach((cb) => cb());
}
export const offlineSavingDisabled = () => savingDisabled;
/** Called when saving is switched off (so pending timers can be cancelled). */
export function onOfflineSavingDisabled(cb: () => void): () => void {
  disableListeners.add(cb);
  return () => void disableListeners.delete(cb);
}

/** Called when saving is switched back on (so a save that was cancelled can be scheduled again). */
export function onOfflineSavingEnabled(cb: () => void): () => void {
  enableListeners.add(cb);
  return () => void enableListeners.delete(cb);
}

// Another tab signing out must stop this tab saving too. Merely clearing the copies (Settings) removes the owner key
// but is not a sign-out: this tab re-claims the owner on its next save (see useOfflineCopy).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null || (e.key === SIGNED_OUT_KEY && e.newValue !== null)) {
      if (!savingDisabled) disabledByOtherTab = true;
      savingDisabled = true;
      disableListeners.forEach((cb) => cb());
    } else if (e.key === OWNER_KEY && e.newValue !== null && disabledByOtherTab && e.newValue === knownOwner) {
      // The same user signed back in in another tab: this tab's session is theirs again, so saving resumes.
      enableOfflineSaving();
    }
  });
}

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
  if (!s || savingDisabled) return false;
  // No recorded owner means the copies were cleared (sign-out in another tab) or never claimed: do not bring one back.
  if (!hasOwner()) return false;
  const savedAt = now.toISOString();
  const payload = JSON.stringify({ savedAt, trip: sanitize(trip) } satisfies TripCopy);
  const entry: TripCopySummary = { id: trip.id, name: trip.name, plannedDate: trip.plannedDate, savedAt, stopCount: trip.stops.length };
  const previous = readIndex(s);
  let index = [entry, ...previous.filter((e) => e.id !== trip.id)].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const overCap = index.slice(MAX_COPIES);
  index = index.slice(0, MAX_COPIES);
  const write = (idx: TripCopySummary[]) => {
    s.setItem(tripKey(trip.id), payload);
    s.setItem(INDEX_KEY, JSON.stringify(idx));
  };
  const ownBefore = safeGet(s, tripKey(trip.id));
  const indexBefore = safeGet(s, INDEX_KEY);
  const rollback = () => {
    // A failed attempt may have written the payload without its index entry: put this trip's slot back as it was (best effort).
    try {
      if (ownBefore === null) s.removeItem(tripKey(trip.id));
      else s.setItem(tripKey(trip.id), ownBefore);
    } catch {
      /* nothing more can be done */
    }
  };
  const removeOverCap = () => {
    for (const e of overCap) {
      try {
        s.removeItem(tripKey(e.id));
      } catch {
        /* ignore */
      }
    }
  };
  // Write first, evict only if that failed: a save that fits never touches the other copies.
  try {
    write(index);
    removeOverCap();
    return true;
  } catch {
    /* quota: see below */
  }
  // A full quota is handled quietly, but nothing is deleted unless the new copy is known to fit afterwards. The free
  // space is measured (a probe write is never a deletion), the oldest other copies are chosen to cover exactly the
  // shortfall, and if even all of them would not cover it the other copies stay untouched.
  rollback();
  const need = tripKey(trip.id).length + payload.length + JSON.stringify(index).length - (ownBefore === null ? 0 : tripKey(trip.id).length + ownBefore.length) - (indexBefore?.length ?? 0) + QUOTA_MARGIN;
  const free = freeSpace(s, need);
  if (free === null) return false;
  const shortfall = need - free;
  const victims: { id: string; raw: string | null }[] = [];
  let freed = 0;
  for (let i = index.length - 1; i >= 0 && freed < shortfall; i--) {
    const e = index[i];
    if (e.id === trip.id) continue;
    const raw = safeGet(s, tripKey(e.id));
    victims.push({ id: e.id, raw });
    freed += (raw === null ? 0 : tripKey(e.id).length + raw.length) + JSON.stringify(e).length + 1; // payload plus its index entry
  }
  if (freed < shortfall) {
    rollback();
    return false;
  }
  // Short window between these removals and the write; if the write still fails the removed copies are put back.
  for (const v of victims) {
    try {
      s.removeItem(tripKey(v.id));
    } catch {
      /* ignore */
    }
  }
  const gone = new Set(victims.map((v) => v.id));
  try {
    write(index.filter((e) => !gone.has(e.id)));
    removeOverCap();
    return true;
  } catch {
    rollback();
    for (const v of victims) {
      if (v.raw === null) continue;
      try {
        s.setItem(tripKey(v.id), v.raw);
      } catch {
        /* best effort: loadTripCopy drops an entry whose payload is gone */
      }
    }
    return false;
  }
}

const QUOTA_MARGIN = 8;
const PROBE_KEY = `${PREFIX}probe`;

const safeGet = (s: Storage, key: string): string | null => {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};

/** How many characters (key included) still fit, up to `limit`, found by probe writes that are removed again; null when nothing can be written at all. */
function freeSpace(s: Storage, limit: number): number | null {
  try {
    s.setItem(PROBE_KEY, "");
  } catch {
    return null; // storage refuses even an empty value: not a size problem we can fix by evicting
  }
  let lo = 0; // known to fit
  let hi = Math.max(0, limit - PROBE_KEY.length); // not yet known
  try {
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      try {
        s.setItem(PROBE_KEY, "x".repeat(mid));
        lo = mid;
      } catch {
        hi = mid - 1;
      }
    }
    return lo + PROBE_KEY.length;
  } finally {
    try {
      s.removeItem(PROBE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Saved trips, most recently saved first. */
export function listTripCopies(): TripCopySummary[] {
  const s = storage();
  return s ? readIndex(s) : [];
}

const LIGHT_PREFS = ["any", "sunrise", "golden", "sunset"] as const;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Shallow validation of one stored stop; fills defaults for fields older copies lack. Null when it cannot be shown safely. */
function normalizeStop(raw: unknown, tripId: string, order: number): Stop | null {
  if (!isObj(raw) || typeof raw.id !== "string" || typeof raw.name !== "string" || !finite(raw.lat) || !finite(raw.lng)) return null;
  const checklist = Array.isArray(raw.shotChecklist)
    ? raw.shotChecklist.filter((i): i is ShotItem => isObj(i) && typeof i.text === "string" && typeof i.done === "boolean").map((i) => ({ text: i.text, done: i.done }))
    : [];
  return {
    id: raw.id,
    tripId: typeof raw.tripId === "string" ? raw.tripId : tripId,
    order: finite(raw.order) ? raw.order : order,
    name: raw.name,
    lat: raw.lat,
    lng: raw.lng,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    source: raw.source === "suggested" ? "suggested" : "manual",
    photoUrl: null,
    visited: raw.visited === true,
    lightPref: (LIGHT_PREFS as readonly unknown[]).includes(raw.lightPref) ? (raw.lightPref as Stop["lightPref"]) : "any",
    priority: raw.priority === "high" || raw.priority === "must" ? raw.priority : "normal",
    dwellMinutes: finite(raw.dwellMinutes) ? raw.dwellMinutes : 0,
    shotNotes: typeof raw.shotNotes === "string" ? raw.shotNotes : null,
    shotChecklist: checklist,
  };
}

function dropEntry(s: Storage, id: string): void {
  try {
    s.removeItem(tripKey(id));
    const rest = readIndex(s).filter((e) => e.id !== id);
    s.setItem(INDEX_KEY, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

/** The stored copy, validated; a corrupt or half-written one (or an index entry whose payload is gone) is dropped and null returned. */
export function loadTripCopy(id: string): TripCopy | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(tripKey(id));
    if (raw === null) {
      if (readIndex(s).some((e) => e.id === id)) dropEntry(s, id); // index/payload drift
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (isObj(parsed) && typeof parsed.savedAt === "string" && isObj(parsed.trip)) {
      const t = parsed.trip;
      if (typeof t.id === "string" && typeof t.name === "string" && typeof t.plannedDate === "string" && Array.isArray(t.stops) && isDateOnly(t.plannedDate) && (t.departAt == null || (typeof t.departAt === "string" && !Number.isNaN(Date.parse(t.departAt))))) {
        const stops = t.stops.map((st, i) => normalizeStop(st, t.id as string, i));
        if (stops.every((st): st is Stop => st !== null)) {
          const trip: TripWithStops = { id: t.id, name: t.name, plannedDate: t.plannedDate, departAt: typeof t.departAt === "string" ? t.departAt : null, shareToken: null, stops };
          return { savedAt: parsed.savedAt, trip };
        }
      }
    }
    dropEntry(s, id);
    return null;
  } catch {
    dropEntry(s, id);
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

/** True once a signed-in page has claimed this device's copies (cleared again by sign-out). */
export function hasOwner(): boolean {
  const s = storage();
  try {
    return !!s && s.getItem(OWNER_KEY) !== null;
  } catch {
    return false;
  }
}

/** The user id that claimed this device's copies, or null. */
export function getOwner(): string | null {
  const s = storage();
  try {
    return s ? s.getItem(OWNER_KEY) : null;
  } catch {
    return null;
  }
}

/** Deletes one trip's copy (the trip was deleted). */
export function removeTripCopy(id: string): void {
  const s = storage();
  if (s) dropEntry(s, id);
}

/** Deletes copies of trips that no longer exist on the server (deleted here or on another device). */
export function pruneTripCopies(existingIds: string[]): void {
  const s = storage();
  if (!s) return;
  const keep = new Set(existingIds);
  for (const e of readIndex(s)) if (!keep.has(e.id)) dropEntry(s, e.id);
}

/** Records whose copies these are; if a different user is signed in now, the old user's copies are wiped first. */
export function claimOwner(userId: string): void {
  if (!savingDisabled) knownOwner = userId;
  const s = storage();
  if (!s || savingDisabled) return;
  try {
    const owner = s.getItem(OWNER_KEY);
    if (owner !== null && owner !== userId) clearAllCopies();
    else if (owner === null && readIndex(s).length > 0) clearAllCopies(); // copies of unknown origin
    s.setItem(OWNER_KEY, userId);
  } catch {
    /* ignore */
  }
}
