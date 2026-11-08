import { after } from "next/server";
import { enforceLimit } from "@/server/rate-limit";
import { suggestionsRequestSchema } from "@/lib/validation";
import { DEADLINE_SUGGESTIONS_MS, handle, HttpError, readJson, requireUserId, withDeadline } from "@/server/http";
import { CorridorError } from "@/server/suggestions/corridor";
import { OverpassError } from "@/server/suggestions/overpass";
import { findSuggestions, findSuggestionsAround } from "@/server/suggestions/service";

export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("suggestions", userId);
  const { coordinates, around, radiusKm, enrich } = suggestionsRequestSchema.parse(await readJson(req));
  const defer = (work: Promise<unknown>) => after(() => work);
  // true when only a stand-in was ready in time (the full answer is still coming), so a caller must not treat it as final.
  let degraded = false;
  const onResult = (info: { degraded: boolean }) => { degraded = info.degraded; };
  try {
    // One deadline over the whole search so sequential upstream timeouts finish inside DEADLINE_SUGGESTIONS_MS (25 s), well before the client's 60 s timeout.
    const tooSlow = (): never => { throw new OverpassError("Suggestions took too long"); };
    if (coordinates) return Response.json({ suggestions: await withDeadline(findSuggestions(coordinates, { enrich, defer, onResult }), DEADLINE_SUGGESTIONS_MS, tooSlow), degraded });
    // Without a radius the service default applies (and keeps the call shape of a plain "around" search).
    const search = radiusKm === undefined ? findSuggestionsAround(around!, { enrich, defer, onResult }) : findSuggestionsAround(around!, { enrich, defer, onResult }, radiusKm);
    return Response.json({ suggestions: await withDeadline(search, DEADLINE_SUGGESTIONS_MS, tooSlow), degraded });
  } catch (e) {
    // The route itself can't be searched along: retrying never helps.
    if (e instanceof CorridorError) throw new HttpError(400, "Route is too complex to search along. Try a shorter or simpler route.");
    if (e instanceof OverpassError) throw new HttpError(502, "Couldn't load suggestions. Please retry.");
    throw e;
  }
});
