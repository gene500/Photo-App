import { describe, expect, it, vi } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridor } from "./corridor";
import { createCellReader, inLocalCoverage, localPlacesAround, localPlacesInRing, RUNS_PER_QUERY, toElements, type PlaceRow } from "./local-places";
import { cellOf } from "./places-grid";

const row = (id: string, lat: number, lng: number, kind = "viewpoint", name = "Spot"): PlaceRow => ({ id, name, kind, lat, lng });

describe("inLocalCoverage", () => {
  it("covers the US and nothing else", () => {
    expect(inLocalCoverage(37.3, -113)).toBe(true); // Zion
    expect(inLocalCoverage(64.8, -147.7)).toBe(true); // Fairbanks
    expect(inLocalCoverage(21.3, -157.8)).toBe(true); // Honolulu
    expect(inLocalCoverage(51.5, -0.1)).toBe(false); // London
    expect(inLocalCoverage(51.0, -114.1)).toBe(false); // Calgary
  });
});

describe("toElements", () => {
  it("shapes rows like Overpass elements and drops malformed ones", () => {
    expect(toElements([row("node/1", 1, 2), row("way/9", 3, 4, "peak", ""), row("bad", 1, 1), row("node/2", 1, 1, "mystery")])).toEqual([
      { type: "node", id: 1, lat: 1, lon: 2, tags: { tourism: "viewpoint", name: "Spot" } },
      { type: "way", id: 9, lat: 3, lon: 4, tags: { natural: "peak" } },
    ]);
  });
});

describe("localPlacesAround", () => {
  it("reads the grid cells around the point and keeps only places inside the circle", async () => {
    const read = vi.fn(async () => [row("node/1", 37.3, -113.03), row("node/2", 37.9, -113.03)]); // second is ~67 km away
    const found = await localPlacesAround(37.2982, -113.0263, 24, read);
    expect(found).toHaveLength(1);
    const cells = (read.mock.calls[0] as unknown as [number[]])[0];
    expect(cells).toContain(cellOf(37.2982, -113.0263));
  });

  it("returns null outside the US, and when the circle reaches over the border", async () => {
    const read = vi.fn(async () => []);
    expect(await localPlacesAround(51.5, -0.1, 24, read)).toBeNull();
    expect(await localPlacesAround(49.3, -123, 24, read)).toBeNull(); // 24 km north of 49.3 is past 49.5
    expect(read).not.toHaveBeenCalled();
  });
});

describe("localPlacesInRing", () => {
  const route: LngLat[] = [[-119.79, 36.74], [-119.0, 37.5]];
  const ring = buildCorridor(route);

  it("keeps places inside the corridor and null when it leaves the covered area", async () => {
    const read = vi.fn(async () => [row("node/1", 37.12, -119.395), row("node/2", 37.4, -119.8)]);
    expect(await localPlacesInRing(ring, read)).toHaveLength(1);
    expect(await localPlacesInRing(buildCorridor([[-0.1, 51.5], [0.2, 51.6]]), read)).toBeNull();
  });
});

describe("createCellReader", () => {
  type RunRow = PlaceRow & { cell: number };
  const placed = (id: string, cell: number): RunRow => ({ id, name: "n", kind: "viewpoint", lat: 0, lng: 0, cell });
  const inRuns = (runs: [number, number][], all: RunRow[]) => all.filter((r) => runs.some(([a, b]) => r.cell >= a && r.cell <= b));
  const table = [placed("node/1", 10), placed("node/2", 11), placed("node/3", 50)];

  it("asks for consecutive cells as runs, in one statement, and returns the rows without the cell column", async () => {
    const run = vi.fn(async (runs: [number, number][]) => inRuns(runs, table));
    const read = createCellReader(run);
    const rows = await read([11, 10, 50, 60]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual([[10, 11], [50, 50], [60, 60]]);
    expect(rows.map((r) => r.id).sort()).toEqual(["node/1", "node/2", "node/3"]);
    expect(rows[0]).not.toHaveProperty("cell");
  });

  it("splits a long list of runs into parallel statements (one round trip deep), each within the limit", async () => {
    let active = 0;
    let maxActive = 0;
    const sizes: number[] = [];
    const run = vi.fn(async (runs: [number, number][]) => {
      sizes.push(runs.length);
      maxActive = Math.max(maxActive, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return [];
    });
    const read = createCellReader(run);
    await read(Array.from({ length: RUNS_PER_QUERY * 2 + 30 }, (_, i) => i * 2)); // all isolated cells: one run each
    expect(sizes.sort((a, b) => a - b)).toEqual([30, RUNS_PER_QUERY, RUNS_PER_QUERY]);
    expect(maxActive).toBe(3);
  });

  it("remembers cells, empty ones too: a repeat or an overlapping read only fetches what is new", async () => {
    const run = vi.fn(async (runs: [number, number][]) => inRuns(runs, table));
    const read = createCellReader(run);
    await read([10, 11, 12]);
    expect(await read([10, 11, 12])).toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(1);
    await read([11, 12, 13]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toEqual([[13, 13]]);
  });

  it("forgets after the time-to-live, on clear(), and never remembers a failed read", async () => {
    let t = 0;
    const run = vi.fn(async (runs: [number, number][]) => inRuns(runs, table));
    const read = createCellReader(run, () => t);
    await read([10]);
    t += 31 * 60_000;
    await read([10]);
    expect(run).toHaveBeenCalledTimes(2);
    read.clear();
    await read([10]);
    expect(run).toHaveBeenCalledTimes(3);

    const failing = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue([placed("node/1", 10)]);
    const read2 = createCellReader(failing);
    await expect(read2([10])).rejects.toThrow("db down");
    expect(await read2([10])).toHaveLength(1);
  });
});
