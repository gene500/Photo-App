import path from "node:path";
import { defineConfig } from "vitest/config";

// Layer-1 location benchmark: PLACES_DB=<sqlite file> LOCS_DIR=<dir of batch*.json> RESULT=<out.json> npx vitest run --config scripts/bench-locations.vitest.mts
for (const k of ["PLACES_DB", "LOCS_DIR", "RESULT"]) if (!process.env[k]) throw new Error(`${k} must be set`);

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  test: {
    environment: "node",
    include: ["scripts/bench-locations.ts"],
    env: { DATABASE_URL: `file:${process.env.PLACES_DB}`, NEXTAUTH_SECRET: "x", EXTERNAL_APIS_FAKE: "" },
    testTimeout: 900_000,
  },
});
