import { enforcePaidLimit } from "@/server/shared-limit";
import { popularityRequestSchema } from "@/lib/validation";
import { handle, readJson, requireUserId } from "@/server/http";
import { isFakeExternal } from "@/server/external/fake";
import { POPULARITY_TIMEOUT_MS, sharedCounter, sharedNotable } from "@/server/suggestions/popularity";

/** Photo-count popularity for one batch of (at most 5) places; the client ranks suggestions as batches arrive. */
export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  await enforcePaidLimit("popularity", userId);
  const { places } = popularityRequestSchema.parse(await readJson(req));
  if (isFakeExternal()) return Response.json({ counts: places.map((_, i) => (i * 7) % 50), notable: places.map((_, i) => i % 2 === 0) });
  const count = sharedCounter();
  const isNotable = sharedNotable();
  const bounded = <T,>(work: Promise<T | undefined>): Promise<T | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([work.catch(() => undefined), new Promise<undefined>((r) => { timer = setTimeout(() => r(undefined), POPULARITY_TIMEOUT_MS); })])
      .finally(() => clearTimeout(timer))
      .then((v) => (v === undefined ? null : v));
  };
  const rows = await Promise.all(
    places.map(async (p) => {
      const place = { osmId: "", name: p.name ?? "", kind: "viewpoint" as const, lat: p.lat, lng: p.lng };
      const [n, w] = await Promise.all([bounded(count(place, fetch)), bounded(isNotable(place, fetch))]);
      return { count: typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null, notable: typeof w === "boolean" ? w : null };
    }),
  );
  return Response.json({ counts: rows.map((r) => r.count), notable: rows.map((r) => r.notable) });
});
