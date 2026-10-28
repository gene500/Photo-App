import { HttpError } from "./http";

/**
 * Server-wide cap on optimizations running at once in this instance. The solver is CPU work on the shared request thread,
 * so a few accounts calling it together would otherwise starve every other request. Extra callers are turned away with a
 * 503 and a Retry-After instead of queueing (a queue would just hold their connections and memory).
 */
export const DEFAULT_MAX_OPTIMIZATIONS = 2;
/** Wall-clock budget for one solve; the best order found by then is returned. */
export const DEFAULT_OPTIMIZE_BUDGET_MS = 1000;
const RETRY_AFTER_SECONDS = 3;

let inFlight = 0;

const intFromEnv = (name: string, fallback: number): number => {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
export const maxOptimizations = () => intFromEnv("OPTIMIZE_MAX_CONCURRENT", DEFAULT_MAX_OPTIMIZATIONS);
export const optimizeBudgetMs = () => intFromEnv("OPTIMIZE_BUDGET_MS", DEFAULT_OPTIMIZE_BUDGET_MS);

/** Runs `work` in a free slot, or throws a 503 when every slot is taken. The slot is always released. */
export async function withOptimizeSlot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= maxOptimizations()) {
    throw new HttpError(503, "The route optimizer is busy right now. Try again in a few seconds.", RETRY_AFTER_SECONDS);
  }
  inFlight++;
  try {
    return await work();
  } finally {
    inFlight--;
  }
}
