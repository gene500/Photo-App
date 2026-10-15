import { haversineMeters } from "@/lib/geo";
import { nameScore } from "./photo-match";
import { photoHeaders, type PlaceQuery } from "./photo-http";

const API = "https://en.wikipedia.org/w/api.php";
const SEARCH_RADIUS_M = 250;
/** With no name match, only an article this close is plausibly about the place itself. */
const NEAREST_MAX_M = 100;
const PAGEVIEW_DAYS = 60;
/** About 5 views a day over two months: an article people actually read, not a stub nobody visits. */
export const NOTABLE_MIN_VIEWS = 300;

type Page = { title?: string; coordinates?: { lat?: number; lon?: number }[]; pageviews?: Record<string, number | null> };

/**
 * Whether Wikipedia has a real, read article about this place. A place with its own article is almost always worth a
 * stop, and the page-view count says whether anyone reads it. Needs no key; one request per place (the same Wikimedia
 * policy and User-Agent as the photo lookups). `true`: a matching article with at least NOTABLE_MIN_VIEWS views in the
 * last 60 days; `false`: no matching article, or too few views; `undefined`: the lookup failed (unknown, not "no").
 */
export async function getWikipediaNotable(place: PlaceQuery, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<boolean | undefined> {
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "geosearch",
      ggscoord: `${place.lat}|${place.lng}`,
      ggsradius: String(SEARCH_RADIUS_M),
      ggslimit: "10",
      prop: "coordinates|pageviews",
      colimit: "10",
      pvipdays: String(PAGEVIEW_DAYS),
    });
    const res = await fetchImpl(`${API}?${params}`, { headers: photoHeaders(), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { query?: { pages?: Record<string, Page> } } | null;
    if (!json || typeof json !== "object") return undefined;
    const pages = Object.values(json.query?.pages ?? {});
    let best: { views: number } | null = null;
    for (const p of pages) {
      if (!p.title) continue;
      const c = p.coordinates?.[0];
      const dist = typeof c?.lat === "number" && typeof c.lon === "number" ? haversineMeters(place, { lat: c.lat, lng: c.lon }) : SEARCH_RADIUS_M;
      const named = place.name ? nameScore(place.name, p.title) > 0 : false;
      if (!named && dist > NEAREST_MAX_M) continue;
      const views = Object.values(p.pageviews ?? {}).reduce<number>((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
      if (!best || views > best.views) best = { views };
    }
    return best !== null && best.views >= NOTABLE_MIN_VIEWS;
  } catch {
    return undefined;
  }
}
