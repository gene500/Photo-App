import { ZodError } from "zod";
import { formatZodError } from "@/lib/validation";
import { getCurrentUserId } from "./session";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Wraps a route handler so thrown errors become safe JSON responses. */
export function handle<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return jsonError(e.status, e.message);
      if (e instanceof ZodError) return jsonError(400, formatZodError(e));
      console.error(e);
      return jsonError(500, "Something went wrong");
    }
  };
}

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new HttpError(401, "Not signed in");
  return userId;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
