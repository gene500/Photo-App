import { z } from "zod";
import { isDateOnly } from "./dates";

export const MAX_ROUTE_WAYPOINTS = 25; // Mapbox Directions driving profile limit

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const dateOnlySchema = z
  .string()
  .refine(isDateOnly, "Planned date must be a valid YYYY-MM-DD date");

export const tripInputSchema = z.object({
  name: z.string().trim().min(1, "Trip name is required").max(120),
  plannedDate: dateOnlySchema,
});
export type TripInput = z.infer<typeof tripInputSchema>;

export const tripPatchSchema = tripInputSchema
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Nothing to update");
export type TripPatch = z.infer<typeof tripPatchSchema>;

export const newStopSchema = z.object({
  name: z.string().trim().min(1, "Stop name is required").max(200),
  lat,
  lng,
  source: z.enum(["manual", "suggested"]),
  notes: z.string().max(5000).nullable().optional(),
});
export type NewStopInput = z.infer<typeof newStopSchema>;

export const stopPatchSchema = z
  .object({
    name: z.string().trim().min(1, "Stop name is required").max(200),
    notes: z.string().max(5000).nullable(),
    visited: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Nothing to update");
export type StopPatch = z.infer<typeof stopPatchSchema>;

export const reorderSchema = z.object({
  stopIds: z.array(z.string().min(1)).min(1, "stopIds must not be empty"),
});

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
});

const lngLat = z.tuple([lng, lat]);

export const directionsRequestSchema = z.object({
  coordinates: z
    .array(lngLat)
    .min(2, "A route needs at least 2 stops")
    .max(MAX_ROUTE_WAYPOINTS, `Routing supports at most ${MAX_ROUTE_WAYPOINTS - 2} stops per trip`),
});

// Keep this far below the point count where @turf/simplify's recursive
// Douglas-Peucker implementation (used by buildCorridor) risks a stack
// overflow on adversarial input, while staying generous for this app's
// real route geometries (routes are capped at MAX_ROUTE_WAYPOINTS = 25
// waypoints, and Mapbox Directions is called with overview=full).
export const MAX_SUGGESTIONS_COORDINATES = 2_000;

export const suggestionsRequestSchema = z.object({
  coordinates: z
    .array(lngLat)
    .min(2, "A route needs at least 2 points")
    .max(MAX_SUGGESTIONS_COORDINATES, `Route has too many points (max ${MAX_SUGGESTIONS_COORDINATES})`),
});

/** First issue as a user-facing string, prefixed with its field path when there is one. */
export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
