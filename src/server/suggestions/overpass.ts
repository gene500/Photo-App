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

function overpassUrl(): string {
  return process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
}

/** One attempt plus one retry on network error, timeout, 429, or 5xx. */
export async function fetchOverpass(query: string, deps: Deps = {}): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? OVERPASS_TIMEOUT_MS;
  let lastError = "Overpass request failed";

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(OVERPASS_RETRY_DELAY_MS);
    try {
      const res = await fetchImpl(overpassUrl(), {
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
