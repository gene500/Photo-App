import { enforceLimit } from "@/server/rate-limit";
import { popularityRequestSchema } from "@/lib/validation";
import { handle, readJson, requireUserId } from "@/server/http";
import { isFakeExternal } from "@/server/external/fake";
import { POPULARITY_TIMEOUT_MS, sharedCounter } from "@/server/suggestions/popularity";

/** Photo-count popularity for one batch of (at most 10) places; the client ranks suggestions as batches arrive. */
export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("popularity", userId);
  const { places } = popularityRequestSchema.parse(await readJson(req));
  if (isFakeExternal()) return Response.json({ counts: places.map((_, i) => (i * 7) % 50) });
  const count = sharedCounter();
  const counts = await Promise.all(
    places.map((p) =>
      Promise.race([
        count({ osmId: "", name: "", kind: "viewpoint", lat: p.lat, lng: p.lng }, fetch).catch(() => undefined),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), POPULARITY_TIMEOUT_MS)),
      ]).then((n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null)),
    ),
  );
  return Response.json({ counts });
});
