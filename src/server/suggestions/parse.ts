import { haversineMeters } from "@/lib/geo";
import type { Suggestion, SuggestionKind } from "@/lib/types";

export const SUGGESTION_CAP = 40;
export const DUPLICATE_RADIUS_M = 100;
/** Matches newStopSchema's name limit, so any suggestion can be added as a stop. */
export const MAX_NAME_LENGTH = 200;

export function classifyKind(tags: Record<string, string>): SuggestionKind | null {
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.natural === "peak") return "peak";
  if (tags.tourism === "attraction") return "attraction";
  return null;
}

/**
 * Names that dedicate a bench, plaque or donated viewing spot rather than name a place ("... Foundation", "In memory of
 * ..."). Map contributors tag these as viewpoints, but they are not somewhere to plan a stop.
 */
const DEDICATION_NAME = /\b(foundation|memorial|in (loving )?memory|in (honou?r|tribute) of|bench|plaque|dedicated|donated by|donation|endowment|trust fund)\b/i;
export const isDedicationName = (name: string): boolean => DEDICATION_NAME.test(name);

const DEFAULT_NAME: Record<SuggestionKind, string> = {
  viewpoint: "Viewpoint",
  peak: "Peak",
  attraction: "Attraction",
};

export const KIND_RANK: Record<SuggestionKind, number> = { viewpoint: 0, peak: 1, attraction: 2 };

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type Candidate = Suggestion & { named: boolean; dist: number };

function toCandidate(el: OverpassElement): Candidate | null {
  if (!el || typeof el !== "object") return null;
  const rawTags = el.tags && typeof el.tags === "object" ? el.tags : {};
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTags)) if (typeof v === "string") tags[k] = v;
  const kind = classifyKind(tags);
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!kind || typeof el.type !== "string" || typeof el.id !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat as number) > 90 || Math.abs(lng as number) > 180) {
    return null;
  }
  const name = tags.name?.trim().slice(0, MAX_NAME_LENGTH).trim();
  if (name && isDedicationName(name)) return null;
  return {
    osmId: `${el.type}/${el.id}`,
    name: name || DEFAULT_NAME[kind],
    lat: lat as number,
    lng: lng as number,
    kind,
    named: Boolean(name),
    dist: 0,
  };
}

function compare(a: Candidate, b: Candidate): number {
  return (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    Number(b.named) - Number(a.named) ||
    a.dist - b.dist ||
    a.osmId.localeCompare(b.osmId)
  );
}

/**
 * Ranks by kind (viewpoints, then peaks, then attractions), named before unnamed, and, when the search has a centre
 * (`origin`), nearest first, so the nearest spots win the cap; then by id, which keeps the order deterministic.
 */
export function parseOverpassResponse(json: unknown, cap: number = SUGGESTION_CAP, origin?: { lat: number; lng: number }): Suggestion[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];

  const byId = new Map<string, Candidate>();
  for (const el of elements) {
    const c = toCandidate(el as OverpassElement);
    if (c && !byId.has(c.osmId)) {
      if (origin) c.dist = haversineMeters(origin, c);
      byId.set(c.osmId, c);
    }
  }

  const kept: Candidate[] = [];
  for (const c of [...byId.values()].sort(compare)) {
    if (kept.length >= cap) break;
    if (kept.some((k) => haversineMeters(k, c) < DUPLICATE_RADIUS_M)) continue;
    kept.push(c);
  }
  return kept.map((c) => ({ osmId: c.osmId, name: c.name, lat: c.lat, lng: c.lng, kind: c.kind }));
}
