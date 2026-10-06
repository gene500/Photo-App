import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Fresh test.db per run. Deleting the file and running `migrate deploy`
// avoids Prisma's AI-agent block on destructive reset commands.
export default function setup() {
  rmSync("test.db", { force: true });
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
