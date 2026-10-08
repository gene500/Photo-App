/** D4 */
export const OVERPASS_TIMEOUT_MS = 12_000;
export const OVERPASS_RETRY_DELAY_MS = 1_000;

export class OverpassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverpassError";
  }
}

type Deps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Public Overpass instances, tried in turn: one busy or rate-limiting a shared host (as Vercel's are) shouldn't fail the search. */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function overpassUrls(): string[] {
  return process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : OVERPASS_ENDPOINTS;
}

/**
 * Tries each endpoint in turn, moving on at once after a network error, timeout, 429 or 5xx; if every one fails, waits a
 * second and gives the first endpoint one more go. A 4xx other than 429 (a bad query) fails immediately.
 */
export async function fetchOverpass(query: string, deps: Deps = {}): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? OVERPASS_TIMEOUT_MS;
  const urls = overpassUrls();
  const attempts = [...urls, urls[0]];
  let lastError = "Overpass request failed";

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    if (attempt === attempts.length - 1) await sleep(OVERPASS_RETRY_DELAY_MS);
    try {
      const res = await fetchImpl(attempts[attempt], {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "road-trip-photo-planner/0.1",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();
      lastError = `Overpass responded ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new OverpassError(lastError);
}
