import { after } from "next/server";
import { enforceLimit } from "@/server/rate-limit";
import { suggestionsRequestSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
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
    if (coordinates) return Response.json({ suggestions: await findSuggestions(coordinates, { enrich, defer, onResult }), degraded });
    // Without a radius the service default applies (and keeps the call shape of a plain "around" search).
    const found = radiusKm === undefined ? await findSuggestionsAround(around!, { enrich, defer, onResult }) : await findSuggestionsAround(around!, { enrich, defer, onResult }, radiusKm);
    return Response.json({ suggestions: found, degraded });
  } catch (e) {
    if (e instanceof OverpassError) throw new HttpError(502, "Couldn't load suggestions. Please retry.");
    throw e;
  }
});
