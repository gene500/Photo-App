import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    ".next-e2e/**",
    // Benchmark and equivalence harnesses with frozen copies of the old algorithms (A82); not app code.
    "scripts/perf/**",
    "scripts/perf-b/**",
    "scripts/perf-c/**",
  ]),
]);

export default eslintConfig;
