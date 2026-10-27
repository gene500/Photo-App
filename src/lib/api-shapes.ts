// Light checks on what the server answers, so a captive-portal page or an odd 200 body ends in a clean error message
// instead of a raw "Cannot destructure property" or a crashed page. They check only what the client dereferences.
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStop = (v: unknown) => isObj(v) && typeof v.id === "string";
const isTrip = (v: unknown) => isObj(v) && typeof v.id === "string";
const isPlace = (v: unknown) => isObj(v) && typeof v.name === "string" && typeof v.lat === "number" && typeof v.lng === "number";

type Check = (body: unknown) => boolean;
const withKey = (key: string, ok: (v: unknown) => boolean): Check => (b) => isObj(b) && ok(b[key]);

export const shapes = {
  trip: withKey("trip", isTrip),
  tripWithStops: withKey("trip", (t) => isTrip(t) && Array.isArray((t as Record<string, unknown>).stops) && ((t as { stops: unknown[] }).stops).every(isStop)),
  tripList: withKey("trips", (v) => Array.isArray(v) && v.every(isTrip)),
  /** `stops` is optional: the other stops a visited change carried along. */
  stop: (b: unknown) => withKey("stop", isStop)(b) && ((b as Record<string, unknown>).stops === undefined || (Array.isArray((b as Record<string, unknown>).stops) && ((b as { stops: unknown[] }).stops).every(isStop))),
  stops: withKey("stops", (v) => Array.isArray(v) && v.every(isStop)),
  route: withKey("route", (r) => isObj(r) && Array.isArray(r.geometry) && Array.isArray(r.legs) && typeof r.distance === "number" && typeof r.duration === "number"),
  order: withKey("order", (v) => Array.isArray(v) && v.every((n) => Number.isInteger(n))),
  suggestions: withKey("suggestions", Array.isArray),
  place: withKey("place", isPlace),
  shareToken: withKey("shareToken", (v) => typeof v === "string"),
};
