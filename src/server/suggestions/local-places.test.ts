import { describe, expect, it, vi } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridor } from "./corridor";
import { inLocalCoverage, localPlacesAround, localPlacesInRing, toElements, type PlaceRow } from "./local-places";
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
