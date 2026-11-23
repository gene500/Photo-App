export type UsagePingKind = "map-load" | "static-map";

/**
 * Tells the server a browser-side Mapbox load is about to happen so it counts against the monthly budget.
 * False only when the server refused with 429 (budget spent); a network failure or other error never blocks the caller.
 * 503 (store outage), 400 and 403 count as true on purpose: an outage lets the image load go uncounted rather than blocked.
 */
export async function sendUsagePing(kind: UsagePingKind): Promise<boolean> {
  try {
    const res = await fetch("/api/usage/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
      keepalive: true,
    });
    return res.status !== 429;
  } catch {
    return true;
  }
}
