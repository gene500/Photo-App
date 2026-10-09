/**
 * Response headers for every route (applied in next.config.ts).
 *
 * script-src keeps 'unsafe-inline': Next's own bootstrap scripts and the theme init script are inline, and
 * a nonce-based policy would need a proxy plus fully dynamic rendering of every page. Everything else is locked
 * down: no framing, no plugins, no foreign form targets, and outbound connections / images only to the hosts
 * the app really uses (Mapbox, and the Wikimedia / Flickr image hosts for place photos).
 */
export function contentSecurityPolicy(dev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
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

export function securityHeaders(dev: boolean): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The app never asks for location, camera or microphone.
    { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(), payment=(), usb=()" },
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
  ];
}
