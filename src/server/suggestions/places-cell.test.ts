import { describe, expect, it } from "vitest";
import { cellOf } from "./places-grid";

describe("import script grid", () => {
  it("computes the same cell as the app", async () => {
    const { cellOf: scriptCellOf } = await import("../../../scripts/places-cell.mjs");
    for (const [lat, lng] of [[37.2982, -113.0263], [64.8, -147.7], [21.3, -157.8], [0.05, 0.05], [-33.9, 151.2]]) {
      expect(scriptCellOf(lat, lng)).toBe(cellOf(lat, lng));
    }
  });
});
