import path from "node:path";
import { defineConfig } from "vitest/config";

// Optimizer comparison: npx vitest run --config scripts/bench-optimize.vitest.mts
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  test: { environment: "node", include: ["scripts/bench-optimize.ts"], testTimeout: 1_800_000 },
});
