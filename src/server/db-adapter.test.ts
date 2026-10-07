import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { describe, expect, it } from "vitest";
import { createAdapter } from "./db-adapter";

describe("createAdapter", () => {
  it("uses libSQL (Turso) when TURSO_DATABASE_URL is set", () => {
    const adapter = createAdapter({ TURSO_DATABASE_URL: "libsql://example.turso.io", TURSO_AUTH_TOKEN: "t" });
    expect(adapter).toBeInstanceOf(PrismaLibSql);
  });

  it("falls back to local SQLite from DATABASE_URL", () => {
    const adapter = createAdapter({ DATABASE_URL: "file:./test.db" });
    expect(adapter).toBeInstanceOf(PrismaBetterSqlite3);
  });
});
