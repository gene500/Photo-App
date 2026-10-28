// The generated photo-spot list, kept per trip in sessionStorage so a reload (or a discarded tab) does not lose it.
// Best-effort like offline-store: storage can be missing, full or blocked and nothing here ever throws.
// Only a finished list is stored; whatever is read back is validated strictly and rebuilt field by field.
import type { Suggestion, SuggestionKind } from "@/lib/types";

const PREFIX = "rtpp.suggestions.";
const VERSION = 1;
const tripKey = (tripId: string) => `${PREFIX}v${VERSION}.${tripId}`;

/** A stored list older than this is ignored. */
export const MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** A list whose JSON is bigger than this is not stored. */
export const MAX_BYTES = 200 * 1024;
const MAX_ITEMS = 500;
const KINDS: readonly SuggestionKind[] = ["viewpoint", "peak", "attraction"];

export type StoredSuggestions = { key: string; items: Suggestion[] };

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) && parsed.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]));
  } catch {
    return false;
  }
}

function cleanItem(v: unknown): Suggestion | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.osmId !== "string" || typeof o.name !== "string" || !isNum(o.lat) || !isNum(o.lng)) return null;
  if (!KINDS.includes(o.kind as SuggestionKind)) return null;
  if (o.popularity !== undefined && !isNum(o.popularity)) return null;
  if (o.notable !== undefined && typeof o.notable !== "boolean") return null;
  return {
    osmId: o.osmId, name: o.name, lat: o.lat, lng: o.lng, kind: o.kind as SuggestionKind,
    ...(o.popularity !== undefined ? { popularity: o.popularity as number } : {}),
    ...(o.notable !== undefined ? { notable: o.notable as boolean } : {}),
  };
}

/** The stored list for a trip, or null when there is none, it is malformed, or it is too old. */
export function loadSuggestions(tripId: string, now: Date = new Date()): StoredSuggestions | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(tripKey(tripId));
    if (raw === null || raw.length > MAX_BYTES) return null;
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const r = o as Record<string, unknown>;
    if (r.v !== VERSION || !isNum(r.savedAt) || !validKey(r.key) || !Array.isArray(r.items) || r.items.length > MAX_ITEMS) return null;
    const age = now.getTime() - r.savedAt;
    if (age < 0 || age > MAX_AGE_MS) return null;
    const items: Suggestion[] = [];
    for (const it of r.items) {
      const c = cleanItem(it);
      if (!c) return null;
      items.push(c);
    }
    return { key: r.key, items };
  } catch {
    return null;
  }
}

/** Stores a finished list. Returns false when nothing was stored (too big, or storage failed); an older stored list is then dropped so it cannot come back stale. */
export function saveSuggestions(tripId: string, list: StoredSuggestions, now: Date = new Date()): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const json = JSON.stringify({ v: VERSION, savedAt: now.getTime(), key: list.key, items: list.items });
    if (json.length > MAX_BYTES) {
      s.removeItem(tripKey(tripId));
      return false;
    }
    s.setItem(tripKey(tripId), json);
    return true;
  } catch {
    return false;
  }
}

export function removeSuggestions(tripId: string): void {
  try {
    storage()?.removeItem(tripKey(tripId));
  } catch {
    /* nothing more to do */
  }
}

/** Removes every trip's list (sign-out, account change, "clear offline data"). */
export function clearAllSuggestions(): void {
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
    /* storage blocked */
  }
}
