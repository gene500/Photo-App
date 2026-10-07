// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stop } from "@/lib/types";
import { FakeMapPanel } from "./FakeMapPanel";

const stop: Stop = { id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false };

describe("FakeMapPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("converts a click position into lat/lng within the default bounds", () => {
    const onMapClick = vi.fn();
    render(<FakeMapPanel stops={[]} routeGeometry={null} onMapClick={onMapClick} onStopClick={vi.fn()} />);
    const map = screen.getByTestId("map");
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(map, { clientX: 100, clientY: 50 });
    const { lat, lng } = onMapClick.mock.calls[0][0];
    expect(lat).toBeCloseTo(37);
    expect(lng).toBeCloseTo(-119.5);
  });

  it("selects a stop without dropping a pin", () => {
    const onMapClick = vi.fn();
    const onStopClick = vi.fn();
    render(<FakeMapPanel stops={[stop]} routeGeometry={[[-120, 36], [-118, 38]]} onMapClick={onMapClick} onStopClick={onStopClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop Pin 1" }));
    expect(onStopClick).toHaveBeenCalledWith("s1");
    expect(onMapClick).not.toHaveBeenCalled();
  });
});
