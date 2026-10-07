import { z } from "zod";
import { ExternalServiceError, geocode } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";

const querySchema = z.string().trim().min(2, "Type at least 2 characters").max(200);

export const GET = handle(async (req: Request) => {
  await requireUserId();
  const q = querySchema.parse(new URL(req.url).searchParams.get("q") ?? "");
  try {
    return Response.json({ places: await geocode(q) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
