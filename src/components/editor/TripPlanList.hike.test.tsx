// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import type { Hike } from "@/lib/hike";
import { DEFAULT_SETTINGS, serializeSettings, SETTINGS_KEY } from "@/lib/settings";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import type { Stop } from "@/lib/types";
import { TripPlanList } from "./TripPlanList";

const useHike = vi.fn();
vi.mock("@/lib/use-hike", () => ({ useHike: (...a: unknown[]) => useHike(...a) }));
vi.mock("@/lib/use-weather", () => ({ useWeatherLine: () => null }));

const stop = (id: string, name: string): Stop => ({
  id, tripId: "t1", order: 0, name, lat: id === "a" ? 37 : 40, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [],
});
const HIKE: Hike = { distanceMeters: 1931, geometry: [[-119.52, 36.99], [-119.5, 37]], source: "osm", attribution: "x" };
const handlers = { onToggleVisited: vi.fn(), onPriorityChange: vi.fn(), onSelect: vi.fn() };
const list = (props: Partial<React.ComponentProps<typeof TripPlanList>> = {}) =>
  render(<SettingsProvider><TripPlanList stops={[stop("a", "Arch"), stop("b", "Plain")]} optimized={false} bestTimes={[null, null]} {...handlers} {...props} /></SettingsProvider>);

describe("TripPlanList hike line", () => {
  beforeEach(() => {
    useHike.mockReset();
    installMemoryStorage();
    useHike.mockImplementation((id: string) => (id === "a" ? HIKE : null));
  });

  it("shows 'Hike X mi one way' only on the stop that has a hike", () => {
    list();
    const lines = screen.getAllByTestId("stop-hike");
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain("Hike 1.2 mi one way");
    expect(within(screen.getAllByTestId("trip-row")[1]).queryByTestId("stop-hike")).toBeNull();
  });

  it("shows distance only: no time, difficulty or elevation", () => {
    list();
    const text = screen.getByTestId("stop-hike").textContent!;
    expect(text).not.toMatch(/min|hour|\bh\b|easy|moderate|hard|elevation|gain|ft\b/i);
  });

  it("uses kilometres when that is the setting", async () => {
    localStorage.setItem(SETTINGS_KEY, serializeSettings({ ...DEFAULT_SETTINGS, distanceUnit: "km" }));
    vi.resetModules(); // the settings store reads storage once per module load
    const { SettingsProvider: Fresh } = await import("@/components/settings/SettingsProvider");
    const { TripPlanList: List } = await import("./TripPlanList");
    render(<Fresh><List stops={[stop("a", "Arch")]} optimized={false} bestTimes={[null]} {...handlers} /></Fresh>);
    expect(screen.getByTestId("stop-hike").textContent).toContain("Hike 1.9 km one way");
  });

  it("does not repeat the data credit on the card (the map's attribution carries it)", () => {
    list();
    expect(screen.queryByTestId("hike-attribution")).toBeNull();
    expect(screen.queryByText(/Trail data/)).toBeNull();
  });

  it("shows nothing at all while loading or when there is no hike", () => {
    useHike.mockReturnValue(null);
    list();
    expect(screen.queryByTestId("stop-hike")).toBeNull();
    expect(screen.queryByTestId("hike-attribution")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show hike/ })).toBeNull();
  });

  it("asks for a hike per stop at the stop's own coordinates", () => {
    list();
    expect(useHike).toHaveBeenCalledWith("a", 37, -119);
    expect(useHike).toHaveBeenCalledWith("b", 40, -119);
  });

  it("has no per-stop Show hike button (it is the Show hikes setting now)", () => {
    list();
    expect(screen.queryByRole("button", { name: /Show hike/ })).toBeNull();
    expect(screen.getByTestId("stop-hike").textContent).toMatch(/^Hike .* one way$/);
  });

  it("is placed after the weather line when the route is optimized", () => {
    const { container } = list({ optimized: true, arrivals: [new Date("2026-07-01T20:00:00Z"), null], bestTimes: [null, null] });
    const row = container.querySelectorAll("[data-testid=trip-row]")[0];
    const html = row.innerHTML;
    expect(html.indexOf("sun-position")).toBeGreaterThan(-1);
    expect(html.indexOf("stop-hike")).toBeGreaterThan(html.indexOf("sun-position"));
  });
});
