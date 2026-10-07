import { haversineMeters } from "@/lib/geo";
import type { PlacePhoto } from "@/lib/types";
import { nameScore } from "./photo-match";
import { allowedHttpsUrl, photoHeaders, PHOTO_TIMEOUT_MS, type PlaceQuery } from "./photo-http";

const API = "https://en.wikipedia.org/w/api.php";
const SEARCH_RADIUS_M = 1500;
/** Without a name match, only a photo this close is plausibly the same place. */
const NEAREST_MAX_M = 300;
/** Wikipedia thumbnails are served from these hosts; nothing else is ever passed to the client. */
export const WIKIMEDIA_IMAGE_HOSTS = ["upload.wikimedia.org", "thumb.wikimedia.org"] as const;

type GeoHit = { pageid?: number; title?: string; lat?: number; lon?: number; dist?: number };
type Page = { pageid?: number; title?: string; fullurl?: string; thumbnail?: { source?: string } };
type Candidate = { title: string; dist: number; thumb: string; pageUrl: string };

const safeImageUrl = (raw: unknown) => allowedHttpsUrl(raw, { hosts: WIKIMEDIA_IMAGE_HOSTS });

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
  const res = await fetchImpl(url, { headers: photoHeaders(), signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Wikipedia photo provider (last resort): the article whose title shares the place's distinctive words,
 * else the nearest article within 300 m. Photos are decorative, so every failure resolves to null.
 */
export async function getWikipediaPhoto(place: PlaceQuery, fetchImpl: typeof fetch = fetch): Promise<PlacePhoto | null> {
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
      .map((c) => ({ c, score: nameScore(place.name, c.title) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.dist - b.c.dist)[0]?.c;
    const best = named ?? candidates.filter((c) => c.dist <= NEAREST_MAX_M).sort((a, b) => a.dist - b.dist)[0];
    return best ? { url: best.thumb, title: best.title, pageUrl: best.pageUrl, credit: "Photo: Wikipedia" } : null;
  } catch {
    return null;
  }
}
