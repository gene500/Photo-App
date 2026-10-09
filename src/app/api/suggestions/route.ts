import { enforceLimit } from "@/server/rate-limit";
import { suggestionsRequestSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { OverpassError } from "@/server/suggestions/overpass";
import { findSuggestions, findSuggestionsAround } from "@/server/suggestions/service";

export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("suggestions", userId);
  const { coordinates, around, radiusKm, enrich } = suggestionsRequestSchema.parse(await readJson(req));
  try {
    if (coordinates) return Response.json({ suggestions: await findSuggestions(coordinates, { enrich }) });
    // Without a radius the service default applies (and keeps the call shape of a plain "around" search).
    const found = radiusKm === undefined ? await findSuggestionsAround(around!, { enrich }) : await findSuggestionsAround(around!, { enrich }, radiusKm);
    return Response.json({ suggestions: found });
  } catch (e) {
    if (e instanceof OverpassError) throw new HttpError(502, "Couldn't load suggestions. Please retry.");
    throw e;
  }
});
