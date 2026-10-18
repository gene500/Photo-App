// Kept apart from http.ts (which imports the session, next-auth and Prisma) so the proxy and the rate limiter can throw it without pulling those into their bundle.
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
