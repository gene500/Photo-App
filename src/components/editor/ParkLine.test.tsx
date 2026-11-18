// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { DEFAULT_SETTINGS, serializeSettings, SETTINGS_KEY } from "@/lib/settings";
import type { Stop } from "@/lib/types";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { StopCard } from "./StopCard";
import { StopDrawer } from "./StopDrawer";
import { TripPlanList } from "./TripPlanList";

vi.mock("@/lib/api-client", () => ({ api: { uploadPhoto: vi.fn(), removePhoto: vi.fn() } }));
vi.mock("@/lib/use-weather", () => ({ useWeatherLine: () => null }));
const useHike = vi.fn();
vi.mock("@/lib/use-hike", () => ({ useHike: (...a: unknown[]) => useHike(...a) }));

const base: Stop = { id: "s1", tripId: "t1", order: 0, name: "Delicate Arch", lat: 37, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], access: null, accessResolvedAt: null };
const withLot = (name: string | null, walkMeters: number | null): Stop => ({ ...base, access: { lat: 37.01, lng: -119.01, name, walkMeters } });
const HIKE = { distanceMeters: 1931, geometry: [[-119, 37], [-119.01, 37.01]], source: "osm", attribution: "x", access: null };

function renderAll(stop: Stop) {
  const wrap = (n: React.ReactNode) => <SettingsProvider>{n}</SettingsProvider>;
  return {
    card: render(wrap(<StopCard stop={stop} bestTime={null as never} arrival={null} onToggleVisited={vi.fn()} onOpenDetails={vi.fn()} onClose={vi.fn()} />)),
    drawer: render(wrap(<StopDrawer plannedDate="2026-07-01" stop={stop} onClose={vi.fn()} onSave={vi.fn()} onPhotoChange={vi.fn()} />)),
    list: render(wrap(<TripPlanList stops={[stop]} optimized={false} bestTimes={[null]} onToggleVisited={vi.fn()} onPriorityChange={vi.fn()} onSelect={vi.fn()} />)),
  };
}

describe("park line in the editor", () => {
  beforeEach(() => {
    useHike.mockReset();
    useHike.mockReturnValue(null);
    installMemoryStorage();
  });

  it("shows 'Park at <lot>, walk N to <stop>' in the stop card, the drawer and the My trip row (miles)", () => {
    useHike.mockReturnValue(HIKE);
    renderAll(withLot("North lot", 1931));
    const lines = screen.getAllByTestId("park-line");
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.textContent).toContain("Park at North lot, walk 1.2 mi (~30 min) to Delicate Arch");
  });

  it("keeps the hike distance in the row when the walk length is unknown", () => {
    useHike.mockReturnValue(HIKE);
    render(<SettingsProvider><TripPlanList stops={[withLot("North lot", null)]} optimized={false} bestTimes={[null]} onToggleVisited={vi.fn()} onPriorityChange={vi.fn()} onSelect={vi.fn()} /></SettingsProvider>);
    expect(screen.getByTestId("park-line").textContent).toBe("Park at North lot");
    expect(screen.getByTestId("stop-hike").textContent).toContain("Hike 1.2 mi one way");
  });

  it("does not repeat the distance: the park line replaces the plain hike text when it has the walk", () => {
    useHike.mockReturnValue(HIKE);
    render(<SettingsProvider><TripPlanList stops={[withLot("North lot", 1931)]} optimized={false} bestTimes={[null]} onToggleVisited={vi.fn()} onPriorityChange={vi.fn()} onSelect={vi.fn()} /></SettingsProvider>);
    expect(screen.queryByTestId("stop-hike")).toBeNull();
  });

  it("says 'the parking lot' when the lot has no name", () => {
    renderAll(withLot(null, 800));
    for (const l of screen.getAllByTestId("park-line")) expect(l.textContent).toContain("Park at the parking lot, walk 0.5 mi (~15 min) to Delicate Arch");
  });

  it("leaves out the walk when its length is not known", () => {
    renderAll(withLot("North lot", null));
    for (const l of screen.getAllByTestId("park-line")) expect(l.textContent).toBe("Park at North lot");
  });

  it("uses kilometres when that is the setting", async () => {
    localStorage.setItem(SETTINGS_KEY, serializeSettings({ ...DEFAULT_SETTINGS, distanceUnit: "km" }));
    vi.resetModules();
    const { SettingsProvider: Fresh } = await import("@/components/settings/SettingsProvider");
    const { StopCard: Card } = await import("./StopCard");
    render(<Fresh><Card stop={withLot("North lot", 1931)} bestTime={null as never} arrival={null} onToggleVisited={vi.fn()} onOpenDetails={vi.fn()} onClose={vi.fn()} /></Fresh>);
    expect(screen.getByTestId("park-line").textContent).toContain("walk 1.9 km (~30 min) to Delicate Arch");
  });

  it("shows no park line and keeps the plain hike text for a stop without a lot", () => {
    useHike.mockReturnValue(HIKE);
    renderAll(base);
    expect(screen.queryByTestId("park-line")).toBeNull();
    expect(screen.getByTestId("stop-hike").textContent).toContain("Hike 1.2 mi one way");
  });
});
