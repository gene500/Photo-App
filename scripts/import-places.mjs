// Loads the local copy of OpenStreetMap photo spots into the `Place` table.
//
//   node scripts/import-places.mjs <dir-of-.jsonl-files> [--replace]
//
// Each line of a .jsonl file is ["node"|"way", osmId, name, "viewpoint"|"peak"|"attraction", lat, lng].
// Writes to Turso when TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) are set, otherwise to DATABASE_URL (default file:./dev.db).
// Rows are upserted by id, so re-running refreshes them; --replace empties the table first.
import { createClient } from "@libsql/client";
import { createReadStream, readdirSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { cellOf } from "./places-cell.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node scripts/import-places.mjs <dir-of-.jsonl-files> [--replace]");
  process.exit(1);
}
const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL ?? "file:./dev.db";
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
console.log(`Importing into ${url.startsWith("libsql:") ? "Turso" : url}`);

if (process.argv.includes("--replace")) await db.execute("DELETE FROM Place");

const KINDS = new Set(["viewpoint", "peak", "attraction"]);
const BATCH = 400;
let batch = [];
let total = 0;
async function flush() {
  if (batch.length === 0) return;
  await db.batch(batch, "write");
  total += batch.length;
  batch = [];
  if (total % 20000 === 0) console.log(`  ${total} rows`);
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
  const lines = readline.createInterface({ input: createReadStream(path.join(dir, file)) });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const [type, id, name, kind, lat, lng] = JSON.parse(line);
    if (!KINDS.has(kind) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    batch.push({
      sql: "INSERT OR REPLACE INTO Place (id, name, kind, lat, lng, cell) VALUES (?, ?, ?, ?, ?, ?)",
      args: [`${type}/${id}`, name, kind, lat, lng, cellOf(lat, lng)],
    });
    if (batch.length >= BATCH) await flush();
  }
  console.log(`${file} done`);
}
await flush();
console.log(`Imported ${total} places.`);
