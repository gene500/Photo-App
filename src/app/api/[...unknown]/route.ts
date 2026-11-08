import { handle, HttpError } from "@/server/http";

/**
 * Any /api path without a route of its own answers a JSON 404 (Next would otherwise render the HTML 404 page, which the
 * API's locked-down CSP shows unstyled). Real routes and /api/auth/* are more specific and win over this catch-all.
 */
const notFound = handle(async (req: Request) => {
  void req;
  throw new HttpError(404, "Not found");
});

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
