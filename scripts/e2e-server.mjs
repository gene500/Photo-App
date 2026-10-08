// Fresh database + no-network externals + isolated build dir, on port 3100 (or E2E_PORT).
const PORT = process.env.E2E_PORT ?? "3100";
import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";

const env = {
  ...process.env,
  DATABASE_URL: "file:./e2e.db",
  EXTERNAL_APIS_FAKE: "1",
  NEXT_PUBLIC_MAP_FAKE: "1",
  // Register the offline service worker in dev for the offline e2e.
  NEXT_PUBLIC_SW: "1",
  NEXT_DIST_DIR: ".next-e2e",
  NEXTAUTH_URL: `http://localhost:${PORT}`,
  NEXTAUTH_SECRET: "e2e-only-secret",
  UPLOAD_DIR: ".e2e-uploads",
  // Never let e2e use a real Blob store from .env.local; photos go to UPLOAD_DIR.
  BLOB_READ_WRITE_TOKEN: "",
  // Likewise never reach a real Turso database (e.g. from a pulled .env.local).
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
};

rmSync("e2e.db", { force: true });
rmSync(".e2e-uploads", { recursive: true, force: true });
execSync("npx prisma migrate deploy", { stdio: "inherit", env });

const child = spawn("npx", ["next", "dev", "--port", PORT], { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
