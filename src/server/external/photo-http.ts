/** Contact-bearing User-Agent required by Wikimedia's API policy; Flickr gets the same one. */
export const PHOTO_USER_AGENT = "RoadTripPhotoPlanner/1.0 (https://photo-app-pi2o.vercel.app)";
export const PHOTO_TIMEOUT_MS = 8000;

export function photoHeaders(): Record<string, string> {
  return { "User-Agent": PHOTO_USER_AGENT, "Api-User-Agent": PHOTO_USER_AGENT };
}

/** https URL whose hostname is one of `hosts` (exact) or a subdomain of one of `suffixes`; anything else is null. */
export function allowedHttpsUrl(raw: unknown, opts: { hosts?: readonly string[]; suffixes?: readonly string[] }): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    const ok = (opts.hosts ?? []).includes(h) || (opts.suffixes ?? []).some((s) => h.endsWith(`.${s}`));
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

export type PlaceQuery = { name: string; lat: number; lng: number };
