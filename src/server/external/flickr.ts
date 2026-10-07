import type { PlacePhoto } from "@/lib/types";
import { nameScore } from "./photo-match";
import { allowedHttpsUrl, photoHeaders, PHOTO_TIMEOUT_MS, type PlaceQuery } from "./photo-http";

const API = "https://api.flickr.com/services/rest/";
/** Official flickr.photos.search docs: geo queries need a limiting parameter, so use a very old min_upload_date. */
const MIN_UPLOAD_DATE = "1072915200"; // 2004-01-01
/** Flickr licence ids we may show with credit (see flickr.photos.licenses.getInfo); everything else is excluded. */
export const FLICKR_LICENSES: Readonly<Record<string, string>> = {
  "1": "CC BY-NC-SA 2.0",
  "2": "CC BY-NC 2.0",
  "3": "CC BY-NC-ND 2.0",
  "4": "CC BY 2.0",
  "5": "CC BY-SA 2.0",
  "6": "CC BY-ND 2.0",
  "9": "CC0",
  "10": "Public Domain Mark",
};
/** Photo images are served from live.staticflickr.com (and legacy farmN.staticflickr.com). */
const IMAGE_SUFFIXES = ["staticflickr.com"] as const;
const OWNER_ID = /^[0-9A-Za-z@_-]{1,40}$/;
const PHOTO_ID = /^\d{1,20}$/;

export const flickrKey = (): string | undefined => process.env.FLICKR_API_KEY?.trim() || undefined;

function searchUrl(key: string, place: PlaceQuery, extra: Record<string, string>): string {
  const params = new URLSearchParams({
    method: "flickr.photos.search",
    api_key: key,
    lat: String(place.lat),
    lon: String(place.lng),
    radius_units: "km",
    has_geo: "1",
    content_types: "0",
    media: "photos",
    min_upload_date: MIN_UPLOAD_DATE,
    format: "json",
    nojsoncallback: "1",
    ...extra,
  });
  return `${API}?${params}`;
}

async function call(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const res = await fetchImpl(url, { headers: photoHeaders(), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown> | null;
  return json && json.stat === "ok" ? json : null;
}

type FlickrPhoto = { id?: unknown; owner?: unknown; ownername?: unknown; license?: unknown; title?: unknown; url_m?: unknown };

/** Flickr provider: the most "interesting" reusable-licence photo within 300 m. Skipped silently without FLICKR_API_KEY. */
export async function getFlickrPhoto(place: PlaceQuery, fetchImpl: typeof fetch = fetch): Promise<PlacePhoto | null> {
  const key = flickrKey();
  if (!key) return null;
  try {
    const url = searchUrl(key, place, {
      radius: "0.3",
      license: Object.keys(FLICKR_LICENSES).join(","),
      sort: "interestingness-desc",
      per_page: "5",
      extras: "url_m,owner_name,license",
    });
    const json = await call(url, fetchImpl, PHOTO_TIMEOUT_MS);
    const list = (json?.photos as { photo?: FlickrPhoto[] } | undefined)?.photo;
    if (!Array.isArray(list)) return null;
    const valid: PlacePhoto[] = [];
    for (const p of list) {
      const thumb = allowedHttpsUrl(p.url_m, { suffixes: IMAGE_SUFFIXES });
      const license = FLICKR_LICENSES[String(p.license)];
      if (!thumb || !license || typeof p.owner !== "string" || !OWNER_ID.test(p.owner) || !PHOTO_ID.test(String(p.id))) continue;
      const owner = typeof p.ownername === "string" ? p.ownername.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      valid.push({
        url: thumb,
        title: typeof p.title === "string" && p.title.trim() ? p.title.trim().slice(0, 120) : place.name,
        pageUrl: `https://www.flickr.com/photos/${encodeURIComponent(p.owner).replace(/%40/g, "@")}/${p.id}`,
        credit: `Photo: ${owner || "Flickr user"} via Flickr (${license})`,
      });
    }
    // Most interesting first, but a photo whose title names the place wins (titles are free text, so this is a bonus only).
    return valid.find((v) => nameScore(place.name, v.title) > 0) ?? valid[0] ?? null;
  } catch {
    return null;
  }
}

/** Number of Flickr photos within 250 m (photos.total), or undefined on any failure / without a key. */
export async function getFlickrPhotoCount(place: PlaceQuery, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<number | undefined> {
  const key = flickrKey();
  if (!key) return undefined;
  try {
    const json = await call(searchUrl(key, place, { radius: "0.25", per_page: "1" }), fetchImpl, timeoutMs);
    const total = Number((json?.photos as { total?: unknown } | undefined)?.total);
    return Number.isFinite(total) && total >= 0 ? total : undefined;
  } catch {
    return undefined;
  }
}
