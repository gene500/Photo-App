import path from "node:path";
import { defineConfig } from "vitest/config";

// Run: npx vitest run --config scripts/bench-suggestions-C.config.mts
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  test: {
    environment: "node",
    include: ["scripts/bench-suggestions-C.bench-test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: "file:./test.db", RATE_LIMIT_DISABLED: "1", FLICKR_API_KEY: "", EXTERNAL_APIS_FAKE: "" },
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
