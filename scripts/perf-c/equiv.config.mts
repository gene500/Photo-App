import path from "node:path";
import { defineConfig } from "vitest/config";
// Re-run: perl -e 'alarm 900; exec @ARGV' npx vitest run --config scripts/perf-c/equiv.config.mts
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../src") } },
  test: { environment: "node", include: ["scripts/perf-c/equiv.bench-test.ts"], testTimeout: 900_000 },
});
