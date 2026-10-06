import { z } from "zod";
import { isDateOnly } from "./dates";

export const MAX_ROUTE_WAYPOINTS = 25; // Mapbox Directions driving profile limit

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const placeSchema = z.object({
  name: z.string().trim().min(1, "Place name is required").max(200),
  lat,
  lng,
});

export const dateOnlySchema = z
  .string()
  .refine(isDateOnly, "Planned date must be a valid YYYY-MM-DD date");

export const tripInputSchema = z.object({
  name: z.string().trim().min(1, "Trip name is required").max(120),
  start: placeSchema,
  end: placeSchema,
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
    .min(2, "A route needs a start and an end")
    .max(MAX_ROUTE_WAYPOINTS, `Routing supports at most ${MAX_ROUTE_WAYPOINTS - 2} stops per trip`),
});

export const suggestionsRequestSchema = z.object({
  coordinates: z.array(lngLat).min(2, "A route needs at least 2 points").max(50_000),
});

/** First issue as a user-facing string, prefixed with its field path when there is one. */
export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
