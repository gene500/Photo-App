import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node", // component tests opt into jsdom with `// @vitest-environment jsdom`
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      UPLOAD_DIR: ".test-uploads",
      NEXTAUTH_SECRET: "test-secret",
      RATE_LIMIT_DISABLED: "1", // the limiter has its own tests that switch it on
      SIGNUP_MIN_SECONDS: "0",
    },
    fileParallelism: false, // DB-backed tests share one SQLite file
    reporters: [
      "default",
      ["tdd-guard-vitest", { projectRoot: "/Users/genestone/road-trip-photo-planner" }],
    ],
  },
});
