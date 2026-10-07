import { haversineMeters } from "@/lib/geo";
import type { Suggestion, SuggestionKind } from "@/lib/types";

export const SUGGESTION_CAP = 40;
export const DUPLICATE_RADIUS_M = 100;

export function classifyKind(tags: Record<string, string>): SuggestionKind | null {
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.natural === "peak") return "peak";
  if (tags.tourism === "attraction") return "attraction";
  return null;
}

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

type Candidate = Suggestion & { named: boolean };

function toCandidate(el: OverpassElement): Candidate | null {
  const kind = classifyKind(el.tags ?? {});
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!kind || !el.type || typeof el.id !== "number" || lat === undefined || lng === undefined) {
    return null;
  }
  const name = el.tags?.name?.trim();
  return {
    osmId: `${el.type}/${el.id}`,
    name: name || DEFAULT_NAME[kind],
    lat,
    lng,
    kind,
    named: Boolean(name),
  };
}

function compare(a: Candidate, b: Candidate): number {
  return (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    Number(b.named) - Number(a.named) ||
    a.osmId.localeCompare(b.osmId)
  );
}

export function parseOverpassResponse(json: unknown, cap: number = SUGGESTION_CAP): Suggestion[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];

  const byId = new Map<string, Candidate>();
  for (const el of elements) {
    const c = toCandidate(el as OverpassElement);
    if (c && !byId.has(c.osmId)) byId.set(c.osmId, c);
  }

  const kept: Candidate[] = [];
  for (const c of [...byId.values()].sort(compare)) {
    if (kept.length >= cap) break;
    if (kept.some((k) => haversineMeters(k, c) < DUPLICATE_RADIUS_M)) continue;
    kept.push(c);
  }
  return kept.map((c) => ({ osmId: c.osmId, name: c.name, lat: c.lat, lng: c.lng, kind: c.kind }));
}
