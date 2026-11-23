// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => function Failing({ onUnavailable }: { onUnavailable?: () => void }) {
    useEffect(() => { onUnavailable?.(); }, [onUnavailable]);
    return <div data-testid="real-map" />;
  },
}));

describe("MapView", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("swaps in the offline preview with a notice when the real map cannot start", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "pk.test");
    vi.stubEnv("NEXT_PUBLIC_MAP_FAKE", "");
    const { MapView } = await import("./MapView");
    render(<MapView stops={[]} routeGeometry={null} onMapClick={vi.fn()} onStopClick={vi.fn()} />);
    expect(await screen.findByText(/map could not start/i)).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy(); // FakeMapPanel
    expect(screen.queryByTestId("real-map")).toBeNull();
  });

  it("shows the offline preview with a budget note, and never loads the real map, when the map is not allowed", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "pk.test");
    vi.stubEnv("NEXT_PUBLIC_MAP_FAKE", "");
    const { MapView } = await import("./MapView");
    render(<MapView mapAllowed={false} stops={[]} routeGeometry={null} onMapClick={vi.fn()} onStopClick={vi.fn()} />);
    expect(screen.getByText(/map is paused for now/i)).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.queryByTestId("real-map")).toBeNull();
  });
});

