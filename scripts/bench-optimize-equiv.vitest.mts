import path from "node:path";
import { defineConfig } from "vitest/config";

// Equivalence + timing of optimizer strategies against the frozen baseline. See scripts/bench-optimize-equiv.ts.
//   STAGE=order|schedule CASES=5000 REPS=20 perl -e 'alarm 3000; exec @ARGV' npx vitest run --config scripts/bench-optimize-equiv.vitest.mts
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  test: { environment: "node", include: ["scripts/bench-optimize-equiv.ts"], testTimeout: 3_000_000, fileParallelism: false },
});
