import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node", // component tests opt into jsdom with `// @vitest-environment jsdom`
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      UPLOAD_DIR: ".test-uploads",
      NEXTAUTH_SECRET: "test-secret",
    },
    fileParallelism: false, // DB-backed tests share one SQLite file
    reporters: [
      "default",
      ["tdd-guard-vitest", { projectRoot: "/Users/genestone/road-trip-photo-planner" }],
    ],
  },
});
