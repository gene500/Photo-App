import { haversineMeters } from "@/lib/geo";
import type { PlacePhoto } from "@/lib/types";
import { fakePlacePhoto, isFakeExternal } from "./fake";

const API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "RoadTripPhotoPlanner/1.0 (personal project)";
const TIMEOUT_MS = 8000;
const SEARCH_RADIUS_M = 1500;
/** Without a name match, only a photo this close is plausibly the same place. */
const NEAREST_MAX_M = 300;
/** Wikipedia thumbnails are served from these hosts; nothing else is ever passed to the client. */
const IMAGE_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
// Words that say what a place is rather than which place it is (incl. our default names).
const GENERIC = new Set(["the", "a", "an", "of", "and", "at", "in", "viewpoint", "view", "overlook", "lookout", "vista", "scenic", "peak", "mount", "mountain", "mt", "point", "attraction"]);

type Point = { name: string; lat: number; lng: number };
type GeoHit = { pageid?: number; title?: string; lat?: number; lon?: number; dist?: number };
type Page = { pageid?: number; title?: string; fullurl?: string; thumbnail?: { source?: string } };
type Candidate = { title: string; dist: number; thumb: string; pageUrl: string };

function tokens(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !GENERIC.has(t));
}

/** Share of the smaller token set found in the other (0 when either side has no distinctive words). */
function nameOverlap(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function safeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && IMAGE_HOSTS.has(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

function safePageUrl(raw: unknown, title: string): string {
  if (typeof raw === "string") {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" && u.hostname === "en.wikipedia.org") return u.toString();
    } catch {
      /* fall through */
    }
  }
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function getJson(params: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ action: "query", format: "json", ...params })}`;
  const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Best-effort Wikipedia photo for a place: the article whose title shares the place's distinctive words,
 * else the nearest article within 300 m. Photos are decorative, so every failure resolves to null.
 */
export async function getPlacePhoto(place: Point, fetchImpl: typeof fetch = fetch): Promise<PlacePhoto | null> {
  if (isFakeExternal()) return fakePlacePhoto(place);
  try {
    const geo = (await getJson({ list: "geosearch", gscoord: `${place.lat}|${place.lng}`, gsradius: String(SEARCH_RADIUS_M), gslimit: "10" }, fetchImpl)) as
      | { query?: { geosearch?: GeoHit[] } }
      | null;
    const hits = (geo?.query?.geosearch ?? []).filter((h): h is GeoHit & { pageid: number } => typeof h.pageid === "number");
    if (!hits.length) return null;

    const info = (await getJson({ prop: "pageimages|info", inprop: "url", piprop: "thumbnail", pithumbsize: "480", pageids: hits.map((h) => h.pageid).join("|") }, fetchImpl)) as
      | { query?: { pages?: Record<string, Page> } }
      | null;
    const pages = info?.query?.pages ?? {};

    const candidates: Candidate[] = [];
    for (const h of hits) {
      const page = pages[String(h.pageid)];
      const thumb = safeImageUrl(page?.thumbnail?.source);
      const title = page?.title ?? h.title;
      if (!thumb || !title) continue;
      const dist =
        typeof h.dist === "number"
          ? h.dist
          : typeof h.lat === "number" && typeof h.lon === "number"
            ? haversineMeters(place, { lat: h.lat, lng: h.lon })
            : Infinity;
      candidates.push({ title, dist, thumb, pageUrl: safePageUrl(page?.fullurl, title) });
    }

    const named = candidates
      .map((c) => ({ c, score: nameOverlap(place.name, c.title) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score || a.c.dist - b.c.dist)[0]?.c;
    const best = named ?? candidates.filter((c) => c.dist <= NEAREST_MAX_M).sort((a, b) => a.dist - b.dist)[0];
    return best ? { url: best.thumb, title: best.title, pageUrl: best.pageUrl, credit: "Wikipedia" } : null;
  } catch {
    return null;
  }
}
