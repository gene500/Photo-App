import { haversineMeters } from "@/lib/geo";
import type { LngLat } from "@/lib/types";
import { prisma } from "../db";
import { TtlCache } from "./cache";
import { cellRuns, cellsForCircle, cellsForRing, pointInRing } from "./places-grid";

/** Rows of the local `Place` table. */
export type PlaceRow = { id: string; name: string; kind: string; lat: number; lng: number };

/**
 * The local copy only holds the United States (the 50 states and DC). Anywhere else, or too near a border to be sure
 * nothing lies across it, the public Overpass servers are asked instead.
 */
const US_BOXES = [
  { minLat: 24.4, maxLat: 49.5, minLng: -125.1, maxLng: -66.9 }, // lower 48
  { minLat: 51, maxLat: 71.6, minLng: -179.9, maxLng: -129.9 }, // Alaska
  { minLat: 18.8, maxLat: 22.4, minLng: -160.7, maxLng: -154.7 }, // Hawaii
];

export function inLocalCoverage(lat: number, lng: number): boolean {
  return US_BOXES.some((b) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng);
}

/** Rows of consecutive cells are read with one `cell BETWEEN a AND b` term each; a statement carries at most this many terms. */
export const RUNS_PER_QUERY = 100;
export const CELL_CACHE_TTL_MS = 30 * 60_000;
export const CELL_CACHE_MAX = 3000;

export type CellReader = (cells: number[]) => Promise<PlaceRow[]>;

/** Reads the rows of the given runs of cells; one round trip per call. */
type RunReader = (runs: [number, number][]) => Promise<(PlaceRow & { cell: number })[]>;

/**
 * Plain SQL rather than `findMany({ where: { OR: [...] } })`: the same query plan (one index range search per run), but
 * without Prisma building and compiling a big OR tree, which is about twice as fast. Every value is a bound parameter.
 */
const readRuns: RunReader = async (runs) => {
  const where = runs.map(() => "cell BETWEEN ? AND ?").join(" OR ");
  const rows = await prisma.$queryRawUnsafe<(PlaceRow & { cell: number | bigint })[]>(`SELECT id, name, kind, lat, lng, cell FROM Place WHERE ${where}`, ...runs.flat());
  return rows.map((r) => ({ ...r, cell: Number(r.cell) }));
};

/**
 * A cell reader that turns the wanted cells into runs, asks the database for them in parallel statements of at most
 * `RUNS_PER_QUERY` runs (so a search is a single round trip however long the route), and remembers every cell it has read
 * (empty ones too) for a while, so a nearby second search needs no round trip at all. Nothing is remembered if a read fails.
 */
export function createCellReader(readRunRows: RunReader, now: () => number = Date.now): CellReader & { clear: () => void } {
  const cache = new TtlCache<PlaceRow[]>(CELL_CACHE_TTL_MS, CELL_CACHE_MAX, now);
  const reader = async (cells: number[]): Promise<PlaceRow[]> => {
    const wanted = [...new Set(cells)];
    const have = new Map<number, PlaceRow[]>();
    const missing: number[] = [];
    for (const cell of wanted) {
      const hit = cache.get(String(cell));
      if (hit) have.set(cell, hit);
      else missing.push(cell);
    }
    if (missing.length > 0) {
      const runs = cellRuns(missing);
      const groups: [number, number][][] = [];
      for (let i = 0; i < runs.length; i += RUNS_PER_QUERY) groups.push(runs.slice(i, i + RUNS_PER_QUERY));
      const fetched = (await Promise.all(groups.map(readRunRows))).flat();
      const byCell = new Map<number, PlaceRow[]>(missing.map((c) => [c, []]));
      for (const { cell, ...row } of fetched) byCell.get(cell)?.push(row);
      for (const [cell, rows] of byCell) {
        cache.set(String(cell), rows);
        have.set(cell, rows);
      }
    }
    return wanted.flatMap((cell) => have.get(cell) ?? []);
  };
  reader.clear = () => cache.clear();
  return reader;
}

const defaultReader = createCellReader(readRuns);
const readCells: CellReader = defaultReader;

/** Forgets the remembered cells (tests, and after a data re-import in a long-lived process). */
export const clearCellCache = (): void => defaultReader.clear();

const KIND_TAGS: Record<string, Record<string, string>> = {
  viewpoint: { tourism: "viewpoint" },
  peak: { natural: "peak" },
  attraction: { tourism: "attraction" },
};

/** Rows shaped like Overpass elements, so the one parser (ranking, de-duplication, cap) serves both sources. */
export function toElements(rows: PlaceRow[]): unknown[] {
  return rows.flatMap((r) => {
    const [type, id] = r.id.split("/");
    const tags = KIND_TAGS[r.kind];
    if (!tags || !type || !Number.isFinite(Number(id))) return [];
    return [{ type, id: Number(id), lat: r.lat, lon: r.lng, tags: r.name ? { ...tags, name: r.name } : { ...tags } }];
  });
}

/** Places within `radiusKm` of a point; null when the point is outside the area the local copy covers. */
export async function localPlacesAround(lat: number, lng: number, radiusKm: number, read: CellReader = readCells): Promise<unknown[] | null> {
  const edge = (dLat: number, dLng: number) => inLocalCoverage(lat + dLat * (radiusKm / 111), lng + dLng * (radiusKm / 111));
  if (!inLocalCoverage(lat, lng) || ![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => edge(a, b))) return null;
  const rows = await read(cellsForCircle(lat, lng, radiusKm));
  return toElements(rows.filter((r) => haversineMeters({ lat, lng }, r) <= radiusKm * 1000));
}

/** Places inside a corridor polygon; null when any part of it lies outside the covered area. */
export async function localPlacesInRing(ring: LngLat[], read: CellReader = readCells): Promise<unknown[] | null> {
  if (ring.length < 3 || !ring.every(([lng, lat]) => inLocalCoverage(lat, lng))) return null;
  const rows = await read(cellsForRing(ring));
  return toElements(rows.filter((r) => pointInRing(r.lng, r.lat, ring)));
}
