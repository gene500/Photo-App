import { suggestionsRequestSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { OverpassError } from "@/server/suggestions/overpass";
import { findSuggestions } from "@/server/suggestions/service";

export const POST = handle(async (req: Request) => {
  await requireUserId();
  const { coordinates } = suggestionsRequestSchema.parse(await readJson(req));
  try {
    return Response.json({ suggestions: await findSuggestions(coordinates) });
  } catch (e) {
    if (e instanceof OverpassError) throw new HttpError(502, "Couldn't load suggestions. Please retry.");
    throw e;
  }
});
