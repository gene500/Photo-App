import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";

type DbEnv = Partial<Record<string, string | undefined>>;

// Hosted deployments use Turso (libSQL); local dev and tests use a SQLite file.
export function createAdapter(env: DbEnv = process.env) {
  if (env.TURSO_DATABASE_URL) {
    return new PrismaLibSql({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  }
  return new PrismaBetterSqlite3({ url: env.DATABASE_URL ?? "file:./dev.db" });
}
