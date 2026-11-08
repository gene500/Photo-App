// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ctor: vi.fn(), supported: vi.fn(() => true), handlers: {} as Record<string, (e: unknown) => void> }));
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));
vi.mock("mapbox-gl", () => ({
  default: {
    supported: () => h.supported(),
    Map: function () { return h.ctor(); },
    NavigationControl: function () {},
    AttributionControl: function () {},
  },
}));
vi.mock("@/components/settings/SettingsProvider", () => ({ useSettings: () => ({ settings: { mapStyle: "standard" } }) }));

import MapPanel from "./MapPanel";

const props = { stops: [], routeGeometry: null, onMapClick: vi.fn(), onStopClick: vi.fn() };

describe("MapPanel fallbacks", () => {
  beforeEach(() => { h.supported.mockReturnValue(true); });
  afterEach(() => { h.ctor.mockReset(); });

  it("calls onUnavailable instead of throwing when the Map constructor fails", () => {
    h.ctor.mockImplementation(() => { throw new Error("Failed to initialize WebGL."); });
    const onUnavailable = vi.fn();
    expect(() => render(<MapPanel {...props} onUnavailable={onUnavailable} />)).not.toThrow();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("calls onUnavailable when mapboxgl.supported() is false", () => {
    h.supported.mockReturnValue(false);
    const onUnavailable = vi.fn();
    render(<MapPanel {...props} onUnavailable={onUnavailable} />);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(h.ctor).not.toHaveBeenCalled();
  });

  it("shows one notice for a rejected token, none for an ordinary error", () => {
    h.ctor.mockImplementation(() => ({
      on: (type: string, fn: (e: unknown) => void) => { h.handlers[type] = fn; },
      off: vi.fn(),
      addControl: vi.fn(),
      remove: vi.fn(),
      getCenter: () => ({ lat: 0, lng: 0 }),
      getZoom: () => 3,
    }));
    render(<MapPanel {...props} />);
    act(() => h.handlers.error({ error: { status: 404 }, tile: {} }));
    expect(screen.queryByText(/Map tiles could not be loaded/)).toBeNull();
    act(() => h.handlers.error({ error: { status: 401 } }));
    act(() => h.handlers.error({ error: { status: 401 } }));
    expect(screen.getAllByText(/Map tiles could not be loaded/)).toHaveLength(1);
  });

  it("also warns when the style itself fails (404, 500, network), and clears once a tile loads", () => {
    h.ctor.mockImplementation(() => ({
      on: (type: string, fn: (e: unknown) => void) => { h.handlers[type] = fn; },
      off: vi.fn(),
      addControl: vi.fn(),
      remove: vi.fn(),
      getCenter: () => ({ lat: 0, lng: 0 }),
      getZoom: () => 3,
    }));
    render(<MapPanel {...props} />);
    act(() => h.handlers.error({ error: { status: 404 } }));
    expect(screen.getAllByText(/Map tiles could not be loaded/)).toHaveLength(1);
    act(() => h.handlers.data({ dataType: "source", tile: {} }));
    expect(screen.queryByText(/Map tiles could not be loaded/)).toBeNull();
    act(() => h.handlers.error({ error: { message: "Failed to fetch" } }));
    expect(screen.getAllByText(/Map tiles could not be loaded/)).toHaveLength(1);
  });
});
