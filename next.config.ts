import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Lets the e2e server use its own build dir alongside a normal `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Native module; must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  // Share links carry a secret in the URL: keep them out of caches, search indexes and Referer headers.
  async headers() {
    return [
      // Hardening headers for everything. Later rules override earlier ones for the same key (e.g. /s below).
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV !== "production") },
      // The worker script itself must always be revalidated so an update reaches users.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      {
        source: "/s/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
