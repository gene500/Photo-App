import path from "node:path";
import { defineConfig } from "vitest/config";

// One database per vitest process, so concurrent runs cannot wipe each other's rows (tests/global-setup.ts creates and removes it).
const testDb = `test-${process.pid}.db`;

const sharedEnv = {
  DATABASE_URL: `file:./${testDb}`,
  UPLOAD_DIR: ".test-uploads",
  NEXTAUTH_SECRET: "test-secret",
  SUGGESTION_SHARED_CACHE_DISABLED: "1", // results are shared through the database; tests must not see each other's
  RATE_LIMIT_DISABLED: "1", // the limiter has its own tests that switch it on
  SIGNUP_MIN_SECONDS: "0",
  TRUST_PROXY_HEADERS: "1", // tests simulate client addresses with x-forwarded-for; clientIp has its own tests for every trust mode
};

// The 5 s default fails slow-but-correct tests (jsdom editor, bcrypt) on a busy machine or a slow CI runner.
const common = {
  environment: "node" as const, // component tests opt into jsdom with `// @vitest-environment jsdom`
  setupFiles: ["tests/setup.ts"],
  env: sharedEnv,
  testTimeout: 20_000,
};

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    // The tdd-guard reporter is a local dev aid; it is skipped on CI, where it only adds a path that can fail to write.
    reporters: process.env.CI
      ? ["default"]
      : ["default", ["tdd-guard-vitest", { projectRoot: import.meta.dirname }]],
    projects: [
      {
        extends: true,
        test: {
          ...common,
          name: "db-and-server",
          // Everything outside src/components and src/lib can touch the shared SQLite file, so these files run one at a time.
          include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
          exclude: ["src/components/**", "src/lib/**", "node_modules/**"],
          globalSetup: ["tests/global-setup.ts"],
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          ...common,
          name: "no-database",
          // Component and pure-library tests never open the database (nothing under src/components or src/lib imports a server module that does).
          include: ["src/components/**/*.test.{ts,tsx}", "src/lib/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
