// One Intl.DateTimeFormat per distinct option set. Building a formatter is far slower than calling .format(), and the clock text is
// formatted for every stop on every render.

const cache = new Map<string, Intl.DateTimeFormat>();

/**
 * The en-US formatter for `options`. With an explicit `options.timeZone` it is built once per `key` (the key must identify the
 * options: callers build it from the values they vary; never pass an untrusted zone, the map has no size limit). With no time zone the runtime's default zone applies, and that can change
 * while the process or the page is open (a device crossing zones or DST, tests setting process.env.TZ), so a fresh formatter is
 * built each time: that is what toLocaleTimeString did before, and it can never be stale.
 */
export function enUsFormatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  if (options.timeZone === undefined) return new Intl.DateTimeFormat("en-US", options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", options);
    cache.set(key, f);
  }
  return f;
}
