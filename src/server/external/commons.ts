import { haversineMeters } from "@/lib/geo";
import type { PlacePhoto } from "@/lib/types";
import { nameScore, fileTitleToName } from "./photo-match";
import { allowedHttpsUrl, photoHeaders, PHOTO_TIMEOUT_MS, type PlaceQuery } from "./photo-http";
import { WIKIMEDIA_IMAGE_HOSTS } from "./wikimedia";

const API = "https://commons.wikimedia.org/w/api.php";
const SEARCH_RADIUS_M = 300;
const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const QUALITY_CATEGORY = /Featured pictures|Quality images|Valued images/i;
const MAX_TEXT = 80;

type Meta = Record<string, { value?: unknown } | undefined>;
type FilePage = {
  title?: string;
  categories?: { title?: string }[];
  imageinfo?: { thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: Meta }[];
};
type Candidate = { title: string; thumb: string; pageUrl: string; credit: string; quality: boolean; dist: number };

/** Plain text from the HTML snippets Commons puts in extmetadata (never returned as markup). */
export function htmlToText(html: string): string {
  let s = html;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/<[^<>]*>/g, " ");
  }
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
  return s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

function metaText(meta: Meta | undefined, key: string): string {
  const v = meta?.[key]?.value;
  return typeof v === "string" ? htmlToText(v).slice(0, MAX_TEXT) : "";
}

function coord(meta: Meta | undefined, key: string): number | null {
  const n = Number(meta?.[key]?.value);
  return Number.isFinite(n) && meta?.[key]?.value !== "" ? n : null;
}

function toCandidate(page: FilePage, place: PlaceQuery): Candidate | null {
  const info = page.imageinfo?.[0];
  const title = page.title;
  if (!info || !title || !info.mime || !PHOTO_MIMES.has(info.mime)) return null;
  const thumb = allowedHttpsUrl(info.thumburl, { hosts: WIKIMEDIA_IMAGE_HOSTS });
  if (!thumb) return null;
  const pageUrl = allowedHttpsUrl(info.descriptionurl, { hosts: ["commons.wikimedia.org"] });
  if (!pageUrl) return null;
  const meta = info.extmetadata;
  const artist = metaText(meta, "Artist");
  const license = metaText(meta, "LicenseShortName");
  const credit = `Photo: ${artist ? `${artist} via ` : ""}Wikimedia Commons${license ? ` (${license})` : ""}`;
  const cats = [...(page.categories ?? []).map((c) => c.title ?? ""), ...String(meta?.Categories?.value ?? "").split("|")];
  const lat = coord(meta, "GPSLatitude");
  const lng = coord(meta, "GPSLongitude");
  const dist = lat !== null && lng !== null ? haversineMeters(place, { lat, lng }) : SEARCH_RADIUS_M;
  return { title: fileTitleToName(title), thumb, pageUrl, credit, quality: cats.some((c) => QUALITY_CATEGORY.test(c)), dist };
}

/**
 * Wikimedia Commons provider: geotagged files within 300 m. Ranked: featured/quality/valued images first,
 * then files whose name shares the place's distinctive words, then nearest. Files with no name match must be
 * on the spot (<= 300 m, the search radius) to count.
 */
export async function getCommonsPhoto(place: PlaceQuery, fetchImpl: typeof fetch = fetch): Promise<PlacePhoto | null> {
  try {
    const params = new URLSearchParams({
      action: "query",
      generator: "geosearch",
      ggsnamespace: "6",
      ggscoord: `${place.lat}|${place.lng}`,
      ggsradius: String(SEARCH_RADIUS_M),
      ggslimit: "15",
      prop: "imageinfo|categories",
      iiprop: "url|extmetadata|mime",
      iiurlwidth: "480",
      cllimit: "max",
      format: "json",
    });
    const res = await fetchImpl(`${API}?${params}`, { headers: photoHeaders(), signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    if (!res.ok) return null;
    const json = (await res.json()) as { query?: { pages?: Record<string, FilePage> } } | null;
    const pages = Object.values(json?.query?.pages ?? {});
    const best = pages
      .map((p) => toCandidate(p, place))
      .filter((c): c is Candidate => c !== null && c.dist <= SEARCH_RADIUS_M)
      .map((c) => ({ c, score: nameScore(place.name, c.title) }))
      .sort((a, b) => Number(b.c.quality) - Number(a.c.quality) || b.score - a.score || a.c.dist - b.c.dist)[0]?.c;
    return best ? { url: best.thumb, title: best.title, pageUrl: best.pageUrl, credit: best.credit } : null;
  } catch {
    return null;
  }
}

export const COMMONS_COUNT_CAP = 50;

/** Geotagged Commons files within 250 m, capped at 50 (a weaker popularity signal than Flickr). undefined on failure. */
export async function getCommonsPhotoCount(place: PlaceQuery, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<number | undefined> {
  try {
    const params = new URLSearchParams({
      action: "query",
      list: "geosearch",
      gscoord: `${place.lat}|${place.lng}`,
      gsradius: "250",
      gsnamespace: "6",
      gslimit: String(COMMONS_COUNT_CAP),
      format: "json",
    });
    const res = await fetchImpl(`${API}?${params}`, { headers: photoHeaders(), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const hits = ((await res.json()) as { query?: { geosearch?: unknown } } | null)?.query?.geosearch;
    return Array.isArray(hits) ? Math.min(hits.length, COMMONS_COUNT_CAP) : undefined;
  } catch {
    return undefined;
  }
}
