/**
 * A same-origin path that may be used as the "return to" target after logging in, or null. Only a path starting with a
 * single "/" is accepted: no "//" (protocol-relative), no scheme, no backslash (browsers treat "\" like "/"), no control
 * characters, and never the login/signup pages themselves.
 */
export function safeCallbackPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, "http://local.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://local.invalid") return null;
  if (/^\/(login|signup)(\/|$)/.test(url.pathname)) return null;
  return raw;
}

/** "/login", or "/login?callbackUrl=<path>" when the path is safe. */
export function loginUrl(callbackPath?: string | null): string {
  const safe = safeCallbackPath(callbackPath);
  return safe ? `/login?callbackUrl=${encodeURIComponent(safe)}` : "/login";
}
