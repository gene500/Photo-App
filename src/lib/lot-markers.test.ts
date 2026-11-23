import { describe, expect, it } from "vitest";
import type { Stop } from "@/lib/types";
import { groupLots, hiddenLotLabels, estimateLabelWidth, lotAriaLabel, lotLabel, LOT_LABEL_MAX, LOT_MERGE_M, lotSignature } from "./lot-markers";

const mk = (id: string, name: string, access: Stop["access"]): Pick<Stop, "id" | "name" | "access"> => ({ id, name, access });
const lot = (lat: number, lng: number, name: string | null = "North lot") => ({ lat, lng, name, walkMeters: 500 });

describe("lotLabel", () => {
  it("uses the lot name, or Parking when there is none or only blanks", () => {
    expect(lotLabel("North lot")).toBe("North lot");
    expect(lotLabel(null)).toBe("Parking");
    expect(lotLabel("   ")).toBe("Parking");
  });
  it("cuts long names to the limit with an ellipsis, without splitting an emoji", () => {
    const out = lotLabel("Yosemite Valley Trailhead Parking Area");
    expect([...out].length).toBeLessThanOrEqual(LOT_LABEL_MAX);
    expect(out.endsWith("…")).toBe(true);
    const emoji = lotLabel("🅿️".repeat(40));
    expect(emoji).not.toMatch(/[\uD800-\uDBFF]…$/);
  });
});

describe("groupLots", () => {
  it("makes no group for a stop without a lot", () => {
    expect(groupLots([mk("a", "A", null)], null)).toEqual([]);
  });
  it("makes one group per lot, with label and aria-label", () => {
    const g = groupLots([mk("a", "Arch", lot(37, -119)), mk("b", "Bridge", lot(38, -118, null))], null);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ lat: 37, lng: -119, label: "North lot", count: 1, selected: false, stopIds: ["a"] });
    expect(g[0].ariaLabel).toBe("Parking for Arch: North lot");
    expect(g[1].label).toBe("Parking");
    expect(g[1].ariaLabel).toBe("Parking for Bridge: Parking");
  });
  it("merges lots within the merge distance into one group", () => {
    const near = 37 + (LOT_MERGE_M - 10) / 111_320;
    const g = groupLots([mk("a", "Arch", lot(37, -119, "Lot A")), mk("b", "Bridge", lot(near, -119, "Lot B"))], null);
    expect(g).toHaveLength(1);
    expect(g[0].count).toBe(2);
    expect(g[0].label).toBe("Parking ×2");
    expect(g[0].stopIds).toEqual(["a", "b"]);
    expect(g[0].ariaLabel).toBe("Parking for Arch, Bridge: Lot A, Lot B");
  });
  it("keeps lots farther apart than the merge distance separate", () => {
    const far = 37 + (LOT_MERGE_M + 20) / 111_320;
    expect(groupLots([mk("a", "A", lot(37, -119)), mk("b", "B", lot(far, -119))], null)).toHaveLength(2);
  });
  it("lists a shared lot name once", () => {
    const g = groupLots([mk("a", "A", lot(37, -119, "Same")), mk("b", "B", lot(37, -119, "Same"))], null);
    expect(g[0].ariaLabel).toBe("Parking for A, B: Same");
  });
  it("chains: a lot within the distance of ANY member joins, whatever the order", () => {
    const m = (d: number) => 37 + d / 111_320; // metres north of 37
    const india = lot(m(0), -119, "India");
    const juliet = lot(m(29), -119, "Juliet");
    const kilo = lot(m(58), -119, "Kilo"); // 58 m from India, 29 m from Juliet
    const orders = [[0, 1, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0], [1, 0, 2]];
    const all = [mk("i", "I", india), mk("j", "J", juliet), mk("k", "K", kilo)];
    for (const o of orders) {
      const g = groupLots(o.map((i) => all[i]), null);
      expect(g).toHaveLength(1);
      expect(g[0].count).toBe(3);
    }
  });
  it("marks the group of the selected stop", () => {
    const g = groupLots([mk("a", "A", lot(37, -119)), mk("b", "B", lot(38, -119))], "b");
    expect(g.map((x) => x.selected)).toEqual([false, true]);
  });
});

describe("lotSignature", () => {
  it("does not change with the selection, but does when the lots change", () => {
    const stops = [mk("a", "A", lot(37, -119)), mk("b", "B", lot(38, -119))];
    expect(lotSignature(groupLots(stops, "a"))).toBe(lotSignature(groupLots(stops, "b")));
    expect(lotSignature(groupLots(stops, null))).not.toBe(lotSignature(groupLots([stops[0]], null)));
    expect(lotSignature(groupLots(stops, null))).not.toBe(lotSignature(groupLots([stops[0], mk("b", "B2", lot(38, -119))], null)));
  });
});

describe("lotAriaLabel", () => {
  it("is the single-lot form", () => {
    expect(lotAriaLabel(["Arch"], ["North lot"])).toBe("Parking for Arch: North lot");
  });
});

describe("hiddenLotLabels", () => {
  const w = 80;
  it("keeps every label when they do not overlap", () => {
    expect(hiddenLotLabels([{ x: 0, y: 0, width: w }, { x: 300, y: 0, width: w }, { x: 0, y: 100, width: w }])).toEqual([false, false, false]);
  });
  it("hides a later label that overlaps an earlier visible one, keeps the earlier", () => {
    expect(hiddenLotLabels([{ x: 0, y: 0, width: w }, { x: 20, y: 5, width: w }])).toEqual([false, true]);
  });
  it("a hidden label does not hide the next one", () => {
    expect(hiddenLotLabels([{ x: 0, y: 0, width: w }, { x: 20, y: 0, width: w }, { x: 200, y: 0, width: w }])).toEqual([false, true, false]);
    // C overlaps only the hidden B, so it stays.
    expect(hiddenLotLabels([{ x: 0, y: 0, width: w }, { x: 70, y: 0, width: w }, { x: 140, y: 0, width: w }])).toEqual([false, true, false]);
  });
  it("the selected group wins even when it comes later", () => {
    expect(hiddenLotLabels([{ x: 0, y: 0, width: w }, { x: 20, y: 0, width: w, selected: true }])).toEqual([true, false]);
  });
  it("is empty for no input", () => {
    expect(hiddenLotLabels([])).toEqual([]);
  });
});

describe("estimateLabelWidth", () => {
  it("grows with the text and stays within the CSS max width", () => {
    expect(estimateLabelWidth("Parking ×12")).toBeGreaterThan(estimateLabelWidth("P"));
    expect(estimateLabelWidth("x".repeat(100))).toBeLessThanOrEqual(152);
  });
});

describe("road ends", () => {
  const re = (lat: number, lng: number) => ({ lat, lng, name: "Road end", walkMeters: 200, kind: "road-end" as const, trail: null });
  it("labels a single road end 'Road end'", () => {
    expect(groupLots([mk("a", "A", re(37, -119))], null)[0].label).toBe("Road end");
  });
  it("merges two stops sharing one road end into one group labelled Parking ×2", () => {
    const g = groupLots([mk("a", "A", re(37, -119)), mk("b", "B", re(37.0001, -119))], null);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ count: 2, label: "Parking ×2" });
  });
});
