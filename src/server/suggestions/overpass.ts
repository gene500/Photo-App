/** D4 */
export const OVERPASS_TIMEOUT_MS = 28_000;
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
  /** Delay before the next mirror is also asked; Infinity means strictly one after another. */
  hedgeMs?: number;
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

/** How long a mirror gets before the next one is also started (the first answer wins). */
export const OVERPASS_HEDGE_MS = 1_500;

class FatalOverpassError extends OverpassError {}

/**
 * Asks the mirrors for the same query, starting the next one when the previous has failed (network error, timeout, 429,
 * 5xx, or a runtime-error remark) or has not answered within `hedgeMs`; the first good answer wins and the others are
 * abandoned. A slow-but-working main server therefore still answers, while a stalled one costs ~1.5 s, not its full
 * timeout. If every mirror fails, waits a second and gives the first one more go. A 4xx other than 429 (a bad query)
 * fails immediately.
 */
export async function fetchOverpass(query: string, deps: Deps = {}): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? OVERPASS_TIMEOUT_MS;
  const hedgeMs = deps.hedgeMs ?? OVERPASS_HEDGE_MS;
  const urls = overpassUrls();
  const body = new URLSearchParams({ data: query }).toString();

  async function ask(url: string, signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "road-trip-photo-planner/0.1" },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (e) {
      throw new OverpassError(e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) {
      const err = new OverpassError(`Overpass responded ${res.status}`);
      throw res.status !== 429 && res.status < 500 ? new FatalOverpassError(err.message) : err;
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      throw new OverpassError(e instanceof Error ? e.message : String(e));
    }
    // Overpass reports a query that timed out or ran out of memory as a 200 with a remark and empty or partial elements.
    const remark = (json as { remark?: unknown } | null)?.remark;
    if (typeof remark === "string" && /runtime error/i.test(remark)) throw new OverpassError(`Overpass: ${remark}`);
    return json;
  }

  function race(list: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const abort = new AbortController();
      let launched = 0;
      let failed = 0;
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastError = "Overpass request failed";
      const finish = (fn: () => void) => {
        finished = true;
        clearTimeout(timer);
        abort.abort(); // abandon the slower mirrors
        fn();
      };
      const launch = () => {
        if (finished || launched >= list.length) return;
        const url = list[launched++];
        clearTimeout(timer);
        if (launched < list.length && Number.isFinite(hedgeMs)) timer = setTimeout(launch, hedgeMs);
        ask(url, abort.signal).then(
          (json) => finished || finish(() => resolve(json)),
          (e: unknown) => {
            if (finished) return;
            lastError = e instanceof Error ? e.message : String(e);
            if (e instanceof FatalOverpassError) return finish(() => reject(e));
            if (++failed === list.length) return finish(() => reject(new OverpassError(lastError)));
            launch(); // a failure doesn't wait for the hedge timer
          },
        );
      };
      launch();
    });
  }

  try {
    return await race(urls);
  } catch (e) {
    if (e instanceof FatalOverpassError) throw e;
  }
  await sleep(OVERPASS_RETRY_DELAY_MS);
  return race([urls[0]]);
}
