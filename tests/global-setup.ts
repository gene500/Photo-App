import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import type { TestProject } from "vitest/node";

// Each run gets its own database (test-<pid>.db), named in vitest.config.mts and applied here, so a second vitest
// process never wipes the data of one already running. Deleting the file and running `migrate deploy` avoids
// Prisma's AI-agent block on destructive reset commands.
export default function setup(project: TestProject) {
  const url = project.config.env?.DATABASE_URL ?? "file:./test.db";
  const file = url.replace(/^file:/, "");
  const files = [file, `${file}-journal`, `${file}-wal`, `${file}-shm`];
  for (const f of files) rmSync(f, { force: true });
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  return () => {
    for (const f of files) rmSync(f, { force: true });
  };
}
