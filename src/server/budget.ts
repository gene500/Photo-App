import { prisma } from "./db";
import { HttpError } from "./http";
import { isFakeExternal } from "./external/fake";
import { BUDGET_FRACTION, BUDGETS, USER_SHARE_FRACTION, type BudgetProduct } from "./budget-config";

/**
 * Monthly budgets for paid provider products, counted in the shared RateLimitCounter table (one row per product per UTC
 * month) so they hold across serverless instances. Unlike the per-minute limits, these are never disabled by
 * RATE_LIMIT_DISABLED and fail closed when the store is unreachable.
 */

export type BudgetUsage = {
  product: BudgetProduct;
  label: string;
  used: number;
  cap: number | null;
  allowance: number | null;
  confirmed: boolean;
  resetsAt: number;
};

export type MapLoadState = "ok" | "warn" | "shared-off" | "all-off";

const PRODUCTS = Object.keys(BUDGETS) as BudgetProduct[];
const rowKey = (product: BudgetProduct, now: number) => `budget:${product}:${monthKey(now)}`;

/** UTC `YYYY-MM`. */
export function monthKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The first instant of the next UTC month, in epoch ms. */
export function monthEnd(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function budgetCap(product: BudgetProduct): number | null {
  const allowance = BUDGETS[product].allowance;
  return allowance === null ? null : Math.floor(allowance * BUDGET_FRACTION);
}

const resetDate = (now: number) =>
  new Date(monthEnd(now)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * Reserves `units` of this month's budget before the paid call is made. Refuses (429) if that would pass the cap, and
 * (503) if the store cannot be reached. A product without a cap is still counted but never refused.
 */
export async function spendBudget(product: BudgetProduct, units = 1, now = Date.now()): Promise<void> {
  if (!Number.isInteger(units) || units < 1) throw new TypeError(`spendBudget: units must be a positive integer, got ${units}`);
  const cap = budgetCap(product);
  const used = `${BUDGETS[product].label} is used up for this month. It resets on ${resetDate(now)}.`;
  if (cap !== null && units > cap) throw new HttpError(429, used);
  const key = rowKey(product, now);
  const resetAt = monthEnd(now);
  try {
    // One statement, so parallel spends cannot both pass the cap: the update only applies while the result stays within it.
    const rows =
      cap === null
        ? await prisma.$queryRaw<{ count: number }[]>`
            INSERT INTO "RateLimitCounter" ("key", "count", "resetAt") VALUES (${key}, ${units}, ${resetAt})
            ON CONFLICT ("key") DO UPDATE SET "count" = "count" + ${units}
            RETURNING "count"`
        : await prisma.$queryRaw<{ count: number }[]>`
            INSERT INTO "RateLimitCounter" ("key", "count", "resetAt") VALUES (${key}, ${units}, ${resetAt})
            ON CONFLICT ("key") DO UPDATE SET "count" = "count" + ${units}
            WHERE "count" + ${units} <= ${cap}
            RETURNING "count"`;
    if (rows.length === 0) throw new HttpError(429, used);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "The service is busy right now. Try again in a moment.", 5);
  }
}

/**
 * Counts `units` of this month's usage with no cap and no refusal, for something that has already happened (a browser
 * has loaded the map, so refusing cannot undo it). Counting continues past the cap so the 70/80/95% states can be reached.
 * Answers 503 if the store cannot be reached.
 */
export async function recordUsage(product: BudgetProduct, units = 1, now = Date.now()): Promise<void> {
  if (!Number.isInteger(units) || units < 1) throw new TypeError(`recordUsage: units must be a positive integer, got ${units}`);
  const key = rowKey(product, now);
  const resetAt = monthEnd(now);
  try {
    await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt") VALUES (${key}, ${units}, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET "count" = "count" + ${units}
      RETURNING "count"`;
  } catch {
    throw new HttpError(503, "The service is busy right now. Try again in a moment.", 5);
  }
}

const OWNER_TTL_MS = 5 * 60_000;
const ownerCache = new Map<string, { owner: boolean; at: number }>();

/** Test hook: forget cached owner lookups. */
export function clearOwnerCache(): void {
  ownerCache.clear();
}

/** True when the account's email equals OWNER_EMAIL (case-insensitive). Nobody is the owner when OWNER_EMAIL is unset. Cached for 5 minutes per instance. */
export async function isOwner(userId: string): Promise<boolean> {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return false;
  const hit = ownerCache.get(userId);
  if (hit && Date.now() - hit.at < OWNER_TTL_MS) return hit.owner;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const owner = user?.email.toLowerCase() === ownerEmail;
  ownerCache.set(userId, { owner, at: Date.now() });
  return owner;
}

/**
 * Counts `units` against one user's share (30% of the monthly cap) of a product. Refuses (429) past it, and (503) if the store
 * cannot be reached. The owner and products without a cap are never limited.
 */
export async function spendUserShare(product: BudgetProduct, userId: string, units = 1, now = Date.now()): Promise<void> {
  if (!Number.isInteger(units) || units < 1) throw new TypeError(`spendUserShare: units must be a positive integer, got ${units}`);
  if (isFakeExternal()) return;
  const cap = budgetCap(product);
  if (cap === null) return;
  if (await isOwner(userId)) return;
  const share = Math.floor(cap * USER_SHARE_FRACTION);
  const message = `You have used your share of ${BUDGETS[product].label} for this month. It resets on ${resetDate(now)}.`;
  if (units > share) throw new HttpError(429, message);
  const key = `budget-user:${product}:${monthKey(now)}:${userId}`;
  const resetAt = monthEnd(now);
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt") VALUES (${key}, ${units}, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET "count" = "count" + ${units}
      WHERE "count" + ${units} <= ${share}
      RETURNING "count"`;
    if (rows.length === 0) throw new HttpError(429, message);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "The service is busy right now. Try again in a moment.", 5);
  }
}

/** This month's usage for every product. */
export async function getBudgetUsage(now = Date.now()): Promise<BudgetUsage[]> {
  const rows = await prisma.rateLimitCounter.findMany({ where: { key: { startsWith: "budget:" } } });
  const counts = new Map(rows.map((r) => [r.key, r.count]));
  return PRODUCTS.map((product) => ({
    product,
    label: BUDGETS[product].label,
    used: Number(counts.get(rowKey(product, now)) ?? 0),
    cap: budgetCap(product),
    allowance: BUDGETS[product].allowance,
    confirmed: BUDGETS[product].confirmed,
    resetsAt: monthEnd(now),
  }));
}

/** Where map loads stand against the allowance: 70% warn, 80% shared trip pages off, 95% every map off. */
export async function mapLoadState(now = Date.now()): Promise<MapLoadState> {
  const allowance = BUDGETS["mapbox-map-load"].allowance;
  if (allowance === null) return "ok";
  try {
    const row = await prisma.rateLimitCounter.findUnique({ where: { key: rowKey("mapbox-map-load", now) } });
    const share = Number(row?.count ?? 0) / allowance;
    if (share >= 0.95) return "all-off";
    if (share >= BUDGET_FRACTION) return "shared-off";
    if (share >= 0.7) return "warn";
  } catch {
    // Only decides the display, so fail open.
  }
  return "ok";
}
