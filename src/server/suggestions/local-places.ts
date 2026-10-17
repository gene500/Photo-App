import { haversineMeters } from "@/lib/geo";
import type { LngLat } from "@/lib/types";
import { prisma } from "../db";
import { TtlCache } from "./cache";
import { cellRuns, cellsForCircle, cellsForRing, createRingTester, pointInRing } from "./places-grid";

/** Rows of the local `Place` table. */
export type PlaceRow = { id: string; name: string; kind: string; lat: number; lng: number };

/**
 * The local copy only holds the United States (the 50 states and DC). Anywhere else, or too near a border to be sure
 * nothing lies across it, the public Overpass servers are asked instead.
 */
const US_BOXES = [
  { minLat: 51, maxLat: 71.6, minLng: -168.2, maxLng: -141.2 }, // Alaska mainland, west to Cape Prince of Wales (Chukotka and Wrangel Island lie beyond, in Russia)
  { minLat: 51, maxLat: 57.6, minLng: -179.9, maxLng: -168.2 }, // Aleutians and the Pribilofs
  { minLat: 62.9, maxLat: 63.9, minLng: -172.2, maxLng: -168.2 }, // St Lawrence Island
  { minLat: 18.8, maxLat: 22.4, minLng: -160.7, maxLng: -154.7 }, // Hawaii
];

/**
 * The lower 48, drawn a little inside the Canadian and Mexican borders (about 25 km, more near the Great Lakes), so a
 * point near a border is sent to Overpass rather than answered from US-only data. Coasts run out into the sea.
 * Points are [lng, lat].
 */
const LOWER_48: LngLat[] = [
  [-124.9, 48.45], [-123.9, 48.25], [-123.2, 48.2], [-123.0, 48.6], [-95.3, 48.6], [-94.5, 48.4], [-92.0, 48.0], [-89.9, 47.8], [-88.0, 47.6],
  [-85.2, 46.6], [-84.8, 46.1], [-84.0, 45.5], [-83.9, 43.5], [-83.9, 41.7], [-83.0, 41.7], [-82.55, 41.72], [-82.5, 41.9], [-81.0, 42.0],
  [-79.8, 42.1], [-77.5, 43.4], [-76.0, 43.6], [-74.8, 44.5], [-71.5, 44.6], [-70.9, 45.3], [-69.0, 46.0],
  [-67.9, 45.1], [-66.5, 44.5], [-66.5, 43.0], [-69.0, 40.0], [-73.5, 38.5], [-75.0, 35.0], [-79.0, 31.0],
  [-79.5, 25.5], [-80.0, 24.4], [-83.0, 24.3], [-87.0, 27.0], [-93.0, 28.0], [-96.9, 26.1], [-97.9, 26.4],
  [-99.3, 28.0], [-101.0, 29.9], [-103.2, 29.6], [-104.5, 30.2], [-106.2, 32.2], [-108.2, 31.9],
  [-111.1, 31.9], [-114.7, 32.9], [-117.3, 32.6], [-121.0, 32.6], [-124.9, 34.0],
];

export function inLocalCoverage(lat: number, lng: number): boolean {
  return US_BOXES.some((b) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) || pointInRing(lng, lat, LOWER_48);
}

/** Rows of consecutive cells are read with one `cell BETWEEN a AND b` term each; a statement carries at most this many terms. */
export const RUNS_PER_QUERY = 100;
/** A corridor covering more cells than this is refused by the local copy. */
export const MAX_RING_CELLS = 20_000;
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
  // Fixed up in place: copying every row (thousands per search) just to convert one column is measurable.
  for (const r of rows) if (typeof r.cell !== "number") r.cell = Number(r.cell);
  return rows as (PlaceRow & { cell: number })[];
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
      // An explicit literal rather than `{ cell, ...row }`: object rest is several times slower per row.
      for (const r of fetched) byCell.get(r.cell)?.push({ id: r.id, name: r.name, kind: r.kind, lat: r.lat, lng: r.lng });
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
  return ringRows(ring, read);
}

/**
 * For a corridor the covered-area check refused (a park on the border, the Alaska panhandle): whatever US places the local
 * copy holds there. Never complete (the rest may lie across the border), so the caller shows it only as a fallback while
 * Overpass is asked; a corridor wholly abroad simply finds nothing.
 */
export async function localPlacesInRingPartial(ring: LngLat[], read: CellReader = readCells): Promise<unknown[] | null> {
  if (ring.length < 3) return null;
  // Cheap geographic filter: a corridor nowhere near North America has no US places to find (and must not flush the cell cache).
  if (!ring.some(([lng, lat]) => lat >= 17 && lat <= 72 && lng >= -180 && lng <= -64)) return null;
  return ringRows(ring, read);
}

async function ringRows(ring: LngLat[], read: CellReader): Promise<unknown[] | null> {
  const cells = cellsForRing(ring);
  if (cells.length > MAX_RING_CELLS) return null; // not a real corridor: do not read the map for it
  const rows = await read(cells);
  const inside = createRingTester(ring);
  return toElements(rows.filter((r) => inside(r.lng, r.lat)));
}
