// Fresh database + no-network externals + isolated build dir, on port 3100.
import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";

const env = {
  ...process.env,
  DATABASE_URL: "file:./e2e.db",
  EXTERNAL_APIS_FAKE: "1",
  NEXT_PUBLIC_MAP_FAKE: "1",
  NEXT_DIST_DIR: ".next-e2e",
  NEXTAUTH_URL: "http://localhost:3100",
  NEXTAUTH_SECRET: "e2e-only-secret",
  UPLOAD_DIR: ".e2e-uploads",
};

rmSync("e2e.db", { force: true });
rmSync(".e2e-uploads", { recursive: true, force: true });
execSync("npx prisma migrate deploy", { stdio: "inherit", env });

const child = spawn("npx", ["next", "dev", "--port", "3100"], { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
