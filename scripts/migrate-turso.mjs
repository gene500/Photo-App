// Applies prisma/migrations/*/migration.sql to a Turso database, once each.
// Runs as part of `npm run vercel-build`; does nothing without TURSO_DATABASE_URL.
import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.log("TURSO_DATABASE_URL not set; skipping Turso migrations.");
  process.exit(0);
}

/** Prisma migrations are plain `;`-terminated statements (no triggers or semicolons inside literals). */
function splitStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((st) => st.trim())
    .filter(Boolean);
}

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
await db.execute("CREATE TABLE IF NOT EXISTS _applied_migrations (name TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)");
const applied = new Set((await db.execute("SELECT name FROM _applied_migrations")).rows.map((r) => String(r.name)));

const root = path.resolve("prisma/migrations");
const names = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
for (const name of names) {
  if (applied.has(name)) continue;
  const sql = readFileSync(path.join(root, name, "migration.sql"), "utf8");
  // One transaction per migration: its statements and the bookkeeping row commit together or not at all.
  await db.batch(
    [
      ...splitStatements(sql),
      { sql: "INSERT INTO _applied_migrations (name, appliedAt) VALUES (?, ?)", args: [name, new Date().toISOString()] },
    ],
    "write",
  );
  console.log(`Applied migration ${name}`);
}
console.log("Turso migrations up to date.");
await db.close();
