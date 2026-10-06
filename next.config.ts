import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the e2e server use its own build dir alongside a normal `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Native module; must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
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
