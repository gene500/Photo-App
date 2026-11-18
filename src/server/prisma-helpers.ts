// Small helpers shared by the server modules that talk to Prisma.

/** True when `e` is an error object carrying the given Prisma error code (P2002 unique, P2003 foreign key, P2025 record not found). Safe for null and non-objects. */
export function hasPrismaCode(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === code;
}

/** The non-null photo URLs of a list of stops (what the callers delete from storage after the rows are gone). */
export function photoUrlsOf(stops: { photoUrl: string | null }[]): string[] {
  return stops.map((s) => s.photoUrl).filter((u): u is string => u !== null);
}
