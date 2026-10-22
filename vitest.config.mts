import path from "node:path";
import { defineConfig } from "vitest/config";

// One database per vitest process, so concurrent runs cannot wipe each other's rows (tests/global-setup.ts creates and removes it).
const testDb = `test-${process.pid}.db`;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node", // component tests opt into jsdom with `// @vitest-environment jsdom`
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    env: {
      DATABASE_URL: `file:./${testDb}`,
      UPLOAD_DIR: ".test-uploads",
      NEXTAUTH_SECRET: "test-secret",
      SUGGESTION_SHARED_CACHE_DISABLED: "1", // results are shared through the database; tests must not see each other's
      RATE_LIMIT_DISABLED: "1", // the limiter has its own tests that switch it on
      SIGNUP_MIN_SECONDS: "0",
      TRUST_PROXY_HEADERS: "1", // tests simulate client addresses with x-forwarded-for; clientIp has its own tests for every trust mode
    },
    fileParallelism: false, // DB-backed tests share one SQLite file
    // The tdd-guard reporter is a local dev aid; it is skipped on CI, where it only adds a path that can fail to write.
    reporters: process.env.CI
      ? ["default"]
      : ["default", ["tdd-guard-vitest", { projectRoot: import.meta.dirname }]],
  },
});
