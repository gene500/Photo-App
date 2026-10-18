import { z } from "zod";
import { ExternalServiceError, retrievePlace } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";
import { enforcePaidLimit } from "@/server/shared-limit";

// The id goes into an upstream URL path, so only URL-safe characters are let through.
const idSchema = z.string().min(1, "id is required").max(300).regex(/^[A-Za-z0-9_\-=.:]+$/, "invalid id")
  .refine((id) => /[A-Za-z0-9]/.test(id), "invalid id"); // not just dots: ".." would be normalised out of the upstream path
const sessionSchema = z.string().uuid("session must be a uuid");

export const GET = handle(async (req: Request) => {
  await enforcePaidLimit("geocode-retrieve", await requireUserId());
  const params = new URL(req.url).searchParams;
  const id = idSchema.parse(params.get("id") ?? "");
  const session = sessionSchema.parse(params.get("session") ?? "");
  try {
    return Response.json({ place: await retrievePlace(id, session) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
