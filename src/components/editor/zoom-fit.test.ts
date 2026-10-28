// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fitMapToPoints } from "./route-flow-map";
import { fitTargets, ZoomFitControl, ZOOM_FIT_LABEL } from "./zoom-fit";

describe("fitTargets", () => {
  it("lists every stop (lng, lat) then the route points", () => {
    expect(fitTargets([{ lat: 1, lng: 2 }], [[3, 4], [5, 6]])).toEqual([[2, 1], [3, 4], [5, 6]]);
    expect(fitTargets([{ lat: 1, lng: 2 }], null)).toEqual([[2, 1]]);
    expect(fitTargets([], undefined)).toEqual([]);
  });
});

describe("ZoomFitControl", () => {
  it("renders an accessible round-button control and calls onFit on click", () => {
    const onFit = vi.fn();
    const el = new ZoomFitControl(onFit).onAdd();
    const b = el.querySelector("button")!;
    expect(b.type).toBe("button");
    expect(b.getAttribute("aria-label")).toBe(ZOOM_FIT_LABEL);
    expect(b.title).toBe(ZOOM_FIT_LABEL);
    expect(b.querySelector("svg")).not.toBeNull();
    b.click();
    expect(onFit).toHaveBeenCalledTimes(1);
  });

  it("hides with setVisible(false), before and after being added", () => {
    const c = new ZoomFitControl(vi.fn());
    c.setVisible(false);
    const el = c.onAdd();
    expect(el.hidden).toBe(true);
    c.setVisible(true);
    expect(el.hidden).toBe(false);
  });
});

describe("fit call", () => {
  it("fits the bounds of all points with the given padding and duration, capped at zoom 14", () => {
    const map = { fitBounds: vi.fn(), on: vi.fn(), off: vi.fn(), isMoving: () => false };
    const padding = { top: 72, right: 64, bottom: 64, left: 400 };
    fitMapToPoints(map as never, fitTargets([{ lat: 10, lng: 20 }, { lat: 12, lng: 18 }], [[25, 9]]), padding, { duration: 0 });
    expect(map.fitBounds).toHaveBeenCalledWith([[18, 9], [25, 12]], { padding, duration: 0, maxZoom: 14 });
  });
});
