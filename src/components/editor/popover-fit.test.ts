import { describe, expect, it } from "vitest";
import { fitPopover } from "./popover-fit";

const base = { triggerTop: 100, triggerBottom: 140, height: 300, boundsTop: 0, boundsBottom: 800 };

describe("fitPopover", () => {
  it("opens below when it fits", () => {
    expect(fitPopover(base)).toEqual({ placement: "below", maxHeight: null });
  });
  it("opens above when there is more room there", () => {
    const r = fitPopover({ ...base, triggerTop: 600, triggerBottom: 640, boundsBottom: 700 });
    expect(r).toEqual({ placement: "above", maxHeight: 300 });
  });
  it("does not open above into space a clipping ancestor hides: caps below and scrolls", () => {
    // trigger 12 px under the sheet's top edge; the sheet runs to the window bottom
    const r = fitPopover({ triggerTop: 364, triggerBottom: 404, height: 340, boundsTop: 352, boundsBottom: 640 });
    expect(r.placement).toBe("below");
    expect(r.maxHeight).toBe(640 - 408 - 12);
  });
  it("never returns a cap under the minimum", () => {
    const r = fitPopover({ triggerTop: 10, triggerBottom: 50, height: 300, boundsTop: 0, boundsBottom: 60 });
    expect(r.maxHeight).toBe(48);
  });
});
