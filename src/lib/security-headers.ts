/**
 * Content-Security-Policy. Pages get it from src/proxy.ts with a fresh nonce per request: scripts run only if they carry
 * the nonce (Next adds it to its own scripts; the theme init script gets it from the layout) or were loaded by such a
 * script ('strict-dynamic'), so injected markup cannot run script. Without a nonce, `script-src` is just 'self'.
 * style-src keeps 'unsafe-inline' because Mapbox GL and React set inline style attributes. Everything else is locked
 * down: no framing, no plugins, no foreign form targets, and outbound connections / images only to the hosts
 * the app really uses (Mapbox, and the Wikimedia / Flickr image hosts for place photos).
 */
export function contentSecurityPolicy(dev: boolean, nonce?: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : []), ...(dev ? ["'unsafe-eval'"] : [])],
    // Mapbox GL and React set inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://api.mapbox.com",
      "https://upload.wikimedia.org",
      "https://thumb.wikimedia.org",
      "https://live.staticflickr.com",
      "https://*.staticflickr.com",
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      "https://api.mapbox.com",
      "https://events.mapbox.com",
      "https://*.tiles.mapbox.com",
      ...(dev ? ["ws://localhost:*", "http://localhost:*"] : []),
    ],
    // Mapbox GL runs its tile workers from blob: URLs.
    "worker-src": ["'self'", "blob:"],
    "child-src": ["blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** For API responses (JSON, never rendered): nothing may load or frame. Pages get their policy from the proxy. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/** Hardening headers for every route except the CSP (see contentSecurityPolicy and API_CONTENT_SECURITY_POLICY). */
export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The app never asks for location, camera or microphone.
    { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(), payment=(), usb=()" },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  ];
}
