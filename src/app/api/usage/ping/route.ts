import { z } from "zod";
import { recordUsage, spendBudget } from "@/server/budget";
import type { BudgetProduct } from "@/server/budget-config";
import { handle, readJson } from "@/server/http";
import { clientIp } from "@/server/rate-limit";
import { enforceSharedLimit } from "@/server/shared-limit";

const bodySchema = z.object({ kind: z.enum(["map-load", "static-map"]) });

const PRODUCT: Record<z.infer<typeof bodySchema>["kind"], BudgetProduct> = {
  "map-load": "mapbox-map-load",
  "static-map": "mapbox-static-image",
};

/**
 * Counts browser-side Mapbox loads (a map start, a Static Images request), which the server cannot see otherwise.
 * Public on purpose: shared trip pages load a map without a sign-in. Guarded by same-origin (in `handle`), the kind
 * check and a per-address limit.
 */
export const POST = handle(async (req: Request) => {
  const { kind } = bodySchema.parse(await readJson(req, 1024));
  await enforceSharedLimit("usage-ping", clientIp(req.headers));
  // A map load has already happened in the browser, so it is only counted (past the cap too, so the 95% state is reachable).
  if (kind === "map-load") await recordUsage(PRODUCT[kind], 1);
  else await spendBudget(PRODUCT[kind], 1);
  return new Response(null, { status: 204 });
});
