import { ZodError } from "zod";
import { formatZodError } from "@/lib/validation";
import { getCurrentUserId } from "./session";

export class HttpError extends Error {
  readonly status: number;
  /** Seconds for a Retry-After header (429 responses). */
  readonly retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function jsonError(status: number, message: string, retryAfter?: number): Response {
  return Response.json(
    { error: message },
    { status, headers: retryAfter === undefined ? undefined : { "Retry-After": String(retryAfter) } },
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request guard for state-changing routes, on top of SameSite cookies. Browsers always send
 * Sec-Fetch-Site (and Origin on cross-origin POSTs); a request that says it came from another site is refused.
 * Requests with neither header (curl, server-to-server, tests) carry no ambient browser cookies, so they pass.
 */
export function assertSameOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site request refused");
  const origin = req.headers.get("origin");
  if (origin === null) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Cross-site request refused"); // includes the literal "null" origin
  }
  const hosts = new Set<string>([new URL(req.url).host]);
  for (const h of [req.headers.get("host"), req.headers.get("x-forwarded-host")]) if (h) hosts.add(h.split(",")[0]!.trim());
  if (!hosts.has(originHost)) throw new HttpError(403, "Cross-site request refused");
}

/** Wraps a route handler so thrown errors become safe JSON responses. */
export function handle<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      if (args[0] instanceof Request) assertSameOrigin(args[0]);
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return jsonError(e.status, e.message, e.retryAfter);
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

export const MAX_JSON_BYTES = 1024 * 1024;

/**
 * Reads the request body with a hard size cap: a declared Content-Length over the cap is refused before any
 * byte is read, and a body that lies about (or omits) its length is cut off as soon as it exceeds the cap.
 */
export async function readBodyBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () => new HttpError(413, "Request body is too large");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function readJson(req: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const bytes = await readBodyBytes(req, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
