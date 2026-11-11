import path from "node:path";
import { defineConfig } from "vitest/config";

// Run: perl -e 'alarm 900; exec @ARGV' npx vitest run --config scripts/perf-b/bench.config.mts
// Optional env: CASES=5000 (equivalence cases per algorithm), REPS=31 (timing repetitions), OUT=<json path>
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../src") } },
  test: {
    environment: "node",
    env: { DATABASE_URL: "file:./perf-b-unused.db", NEXTAUTH_SECRET: "x" },
    include: ["scripts/perf-b/bench.test.ts"],
    testTimeout: 850_000,
    fileParallelism: false,
  },
});
