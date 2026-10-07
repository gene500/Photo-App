// Decides whether a photo/article title is about the same place as a name. Shared by every photo provider.

const STOP = new Set(["the", "a", "an", "of", "and", "at", "in", "on", "de", "la"]);
// Words that say what a place is rather than which place it is. Two names that each carry such a word but
// share none of them ("Eagle Peak" vs "Eagle Rock") are different places even if the rest matches.
const TYPE = new Set([
  "lake", "beach", "rock", "falls", "fall", "park", "trail", "trailhead", "point", "bay", "river", "mountain", "canyon",
  "creek", "pass", "summit", "ridge", "valley", "island", "pier", "bridge", "peak",
]);
const TYPE_ALIAS: Record<string, string> = { mount: "mountain", mt: "mountain" };
// Generic but never conflicting (our default names are "Viewpoint" / "Peak" / "Attraction").
const SOFT = new Set(["viewpoint", "view", "overlook", "lookout", "vista", "scenic", "national", "state", "attraction"]);
// Noise in file names: numbering, extensions, photo-site suffixes.
const NOISE = new Set(["jpg", "jpeg", "png", "webp", "panoramio", "flickr", "file"]);

type Parts = { distinct: Set<string>; types: Set<string> };

function parts(s: string): Parts {
  const distinct = new Set<string>();
  const types = new Set<string>();
  const words = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const raw of words) {
    const w = TYPE_ALIAS[raw] ?? raw;
    if (STOP.has(w) || SOFT.has(w) || NOISE.has(w) || /^\d+$/.test(w)) continue;
    if (TYPE.has(w)) types.add(w);
    else distinct.add(w);
  }
  return { distinct, types };
}

/**
 * 0 when the names are not plausibly the same place; otherwise a score in (0, 1].
 * A match needs >= 0.5 overlap of the LARGER distinctive-word set, or every distinctive word of the place
 * present in the candidate. Names with no distinctive words never match (callers fall back to distance).
 */
export function nameScore(place: string, candidate: string): number {
  const a = parts(place);
  const b = parts(candidate);
  if (!a.distinct.size || !b.distinct.size) return 0;
  if (a.types.size && b.types.size && ![...a.types].some((t) => b.types.has(t))) return 0;
  let shared = 0;
  for (const t of a.distinct) if (b.distinct.has(t)) shared++;
  if (!shared) return 0;
  const ratio = shared / Math.max(a.distinct.size, b.distinct.size);
  if (ratio >= 0.5) return ratio;
  return shared === a.distinct.size ? 0.5 : 0;
}

export const namesMatch = (place: string, candidate: string): boolean => nameScore(place, candidate) > 0;

/** Strip the "File:" namespace and the extension from a Commons title. */
export function fileTitleToName(title: string): string {
  return title.replace(/^File:/i, "").replace(/\.[a-z0-9]{3,4}$/i, "");
}
