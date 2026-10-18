// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSunWindows } from "@/lib/best-time";
import { lightWindows } from "@/lib/light-windows";
import type { Stop } from "@/lib/types";
import { TripPlanList } from "./TripPlanList";

const useWeatherLine = vi.fn();
vi.mock("@/lib/use-weather", () => ({ useWeatherLine: (...a: unknown[]) => useWeatherLine(...a) }));

const stop = (id: string, name: string, extra: Partial<Stop> = {}): Stop => ({
  id, tripId: "t1", order: 0, name, lat: 37, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...extra,
});
const handlers = { onToggleVisited: vi.fn(), onPriorityChange: vi.fn(), onSelect: vi.fn() };

describe("TripPlanList", () => {
  beforeEach(() => { useWeatherLine.mockReset(); useWeatherLine.mockReturnValue(null); });

  it("shows the forecast under every stop that has an arrival", () => {
    useWeatherLine.mockImplementation((_lat, _lng, at) => (at ? { text: "mostly clear, 15% rain", quality: "poor" } : null));
    render(
      <TripPlanList
        stops={[stop("a", "Sunset", { lightPref: "sunset" }), stop("b", "Plain")]}
        bestTimes={[null, null]}
        arrivals={[new Date("2026-07-01T20:00:00Z"), new Date("2026-07-01T21:00:00Z")]}
        optimized {...handlers}
      />,
    );
    const weather = screen.getAllByTestId("stop-weather");
    expect(weather).toHaveLength(2);
    expect(weather[0].textContent).toBe("mostly clear, 15% rain");
    expect(weather[0].className).toContain("text-sand");
    expect(useWeatherLine).toHaveBeenCalledWith(37, -119, new Date("2026-07-01T20:00:00Z"), "sunset");
    expect(useWeatherLine).toHaveBeenCalledWith(37, -119, new Date("2026-07-01T21:00:00Z"), "any");
  });

  it("shows the poor-light warning only on rows whose line carries one", () => {
    useWeatherLine.mockImplementation((_lat, _lng, at: Date | null) =>
      at ? { text: "overcast", quality: "poor", ...(at.getUTCHours() === 20 ? { warning: "Golden hour: 85% cloud, likely washed out" } : {}) } : null);
    render(
      <TripPlanList
        stops={[stop("a", "Sunset", { lightPref: "golden" }), stop("b", "Plain")]}
        bestTimes={[null, null]}
        arrivals={[new Date("2026-07-01T20:00:00Z"), new Date("2026-07-01T21:00:00Z")]}
        optimized {...handlers}
      />,
    );
    const badges = screen.getAllByTestId("light-warning");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("Golden hour: 85% cloud, likely washed out");
    expect(badges[0].className).toContain("text-sand");
    expect(badges[0].className).not.toContain("text-danger");
  });

  it("shows the light window and arrival for a stop with a preferred light, or how much it is missed", () => {
    const sunsetStop = { lightPref: "sunset" as const, lat: 37.7, lng: -119.6 };
    const sun = getSunWindows(37.7, -119.6, "2026-07-01");
    const [[from, to]] = lightWindows("sunset", sun);
    render(
      <TripPlanList
        stops={[stop("a", "Met", sunsetStop), stop("b", "Missed", sunsetStop), stop("c", "Plain")]}
        bestTimes={[null, null, null]}
        arrivals={[new Date(from.getTime() + 600_000), new Date(to.getTime() + 3 * 3600_000), new Date(from.getTime())]}
        optimized {...handlers}
      />,
    );
    const [met, missed, plain] = screen.getAllByTestId("best-time");
    expect(met.textContent).toMatch(/^Sunset window .* · arrive /);
    expect(met.getAttribute("data-light-met")).toBe("true");
    expect(missed.textContent).toMatch(/^Misses sunset by /);
    expect(missed.className).toContain("text-sand");
    expect(missed.className).not.toContain("text-danger");
    expect(plain.textContent).toBe("No daylight"); // any: unchanged best-time line
  });

  it("renders numbered rows with best time", () => {
    render(
      <TripPlanList
        stops={[stop("a", "Tunnel View"), stop("b", "Olmsted Point")]}
        bestTimes={[{ window: "golden hour", at: new Date("2026-07-02T02:45:00Z") }, null]}
        optimized {...handlers}
      />,
    );
    const rows = screen.getAllByTestId("trip-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("1. Tunnel View");
    expect(within(rows[0]).getByTestId("best-time").textContent).toMatch(/^Golden hour · /);
    expect(within(rows[1]).getByTestId("best-time").textContent).toBe("No daylight");
  });

  describe("priority pill", () => {
    const setup = (extra: Partial<Stop> = {}) => {
      const onPriorityChange = vi.fn();
      render(<TripPlanList stops={[stop("a", "Tunnel View", { lightPref: "golden", ...extra }), stop("b", "Gas stop")]} bestTimes={[null, null]} optimized {...handlers} onPriorityChange={onPriorityChange} />);
      return { onPriorityChange, group: screen.getByRole("radiogroup", { name: "Priority for Tunnel View" }) };
    };

    it("shows three radios on stops with a best light and none for any light", () => {
      const { group } = setup();
      expect(screen.queryByRole("radiogroup", { name: "Priority for Gas stop" })).toBeNull();
      expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Normal", "High", "Must"]);
    });

    it("marks the current priority as checked with a roving tabindex", () => {
      const { group } = setup({ priority: "high" });
      const [n, h, m] = within(group).getAllByRole("radio");
      expect([n, h, m].map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
      expect([n, h, m].map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    });

    it("advances on rapid key presses before the parent has caught up", async () => {
      const { onPriorityChange } = setup();
      screen.getByRole("radio", { name: "Normal" }).focus();
      await userEvent.keyboard("{ArrowRight}{ArrowRight}");
      expect(onPriorityChange.mock.calls).toEqual([["a", "high"], ["a", "must"]]);
      expect(screen.getByRole("radio", { name: "Must-have" }).getAttribute("aria-checked")).toBe("true");
    });

    it("shows the new value at once and reverts when the save fails", async () => {
      let reject!: (e: Error) => void;
      const onPriorityChange = vi.fn(() => new Promise<void>((_r, rej) => { reject = rej; }));
      render(<TripPlanList stops={[stop("a", "Tunnel View", { lightPref: "golden" })]} bestTimes={[null]} optimized {...handlers} onPriorityChange={onPriorityChange} />);
      await userEvent.click(screen.getByRole("radio", { name: "High" }));
      expect(screen.getByRole("radio", { name: "High" }).getAttribute("aria-checked")).toBe("true");
      await act(async () => { reject(new Error("nope")); });
      expect(screen.getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
    });

    it("selects a third on click", async () => {
      const { onPriorityChange } = setup();
      await userEvent.click(screen.getByRole("radio", { name: "High" }));
      expect(onPriorityChange).toHaveBeenCalledWith("a", "high");
      await userEvent.click(screen.getByRole("radio", { name: "Must-have" }));
      expect(onPriorityChange).toHaveBeenCalledWith("a", "must");
    });

    it("moves the selection with the arrow, Home and End keys", async () => {
      const { onPriorityChange } = setup({ priority: "high" });
      screen.getByRole("radio", { name: "High" }).focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(onPriorityChange).toHaveBeenLastCalledWith("a", "must");
      await userEvent.keyboard("{ArrowLeft}");
      expect(onPriorityChange).toHaveBeenLastCalledWith("a", "high");
      await userEvent.keyboard("{End}");
      expect(onPriorityChange).toHaveBeenLastCalledWith("a", "must");
      await userEvent.keyboard("{Home}");
      expect(onPriorityChange).toHaveBeenLastCalledWith("a", "normal");
    });

    it("moves the selection with ArrowUp and ArrowDown", async () => {
      const { onPriorityChange } = setup({ priority: "high" });
      screen.getByRole("radio", { name: "High" }).focus();
      await userEvent.keyboard("{ArrowDown}");
      expect(onPriorityChange).toHaveBeenLastCalledWith("a", "must");
      await userEvent.keyboard("{ArrowUp}");
      expect(onPriorityChange).toHaveBeenLastCalledWith("a", "high");
    });

    it("does nothing when the selected third is chosen again", async () => {
      const { onPriorityChange } = setup();
      await userEvent.click(screen.getByRole("radio", { name: "Normal" }));
      expect(onPriorityChange).not.toHaveBeenCalled();
    });
  });

  it("labels the first and last stops Start and End when there are two or more", () => {
    render(<TripPlanList stops={[stop("a", "A"), stop("b", "B"), stop("c", "C")]} bestTimes={[null, null, null]} optimized {...handlers} />);
    const roles = screen.getAllByTestId("stop-role").map((el) => el.textContent);
    expect(roles).toEqual(["Start", "End"]);
  });

  it("puts the Start/End badge beside the name, never in the line with the light text, so all lines share one left edge", () => {
    const sunsetStop = { lightPref: "sunset" as const, lat: 37.7, lng: -119.6 };
    render(
      <TripPlanList
        stops={[stop("a", "A"), stop("b", "B", sunsetStop)]}
        bestTimes={[null, null]}
        arrivals={[new Date("2026-07-01T20:00:00Z"), new Date("2026-07-01T23:59:00Z")]}
        optimized {...handlers}
      />,
    );
    for (const badge of screen.getAllByTestId("stop-role")) {
      expect(badge.parentElement?.querySelector('[data-testid="best-time"]')).toBeNull();
      expect(badge.parentElement?.querySelector("button")?.textContent).toMatch(/^\d+\./);
    }
  });


  it("gives each Visited checkbox its stop's name", () => {
    render(<TripPlanList stops={[stop("a", "Tunnel View"), stop("b", "Glacier Point")]} optimized bestTimes={[null, null]} {...handlers} />);
    expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Visited: Tunnel View", "Visited: Glacier Point"]);
  });

  it("calls handlers for visited and select", async () => {
    render(<TripPlanList stops={[stop("a", "Tunnel View")]} optimized bestTimes={[null]} {...handlers} />);
    await userEvent.click(screen.getByLabelText("Visited: Tunnel View"));
    await userEvent.click(screen.getByRole("button", { name: "1. Tunnel View" }));
    expect(handlers.onToggleVisited).toHaveBeenCalledWith("a", true);
    expect(handlers.onSelect).toHaveBeenCalledWith("a");
  });

  it("does not label a lone stop", () => {
    render(<TripPlanList stops={[stop("a", "A")]} optimized bestTimes={[null]} {...handlers} />);
    expect(screen.queryAllByTestId("stop-role")).toHaveLength(0);
  });

  it("shows an empty state", () => {
    render(<TripPlanList stops={[]} optimized={false} bestTimes={[]} {...handlers} />);
    expect(screen.getByText("No stops yet.")).toBeTruthy();
  });

  it("before Optimize shows only number, name, role and priority", () => {
    useWeatherLine.mockReturnValue({ text: "overcast", quality: "poor", warning: "Golden hour: 85% cloud" });
    render(
      <TripPlanList
        stops={[stop("a", "A"), stop("b", "B", { lightPref: "golden" })]}
        optimized={false}
        bestTimes={[null, null]}
        arrivals={[new Date("2026-07-01T20:00:00Z"), new Date("2026-07-01T21:00:00Z")]}
        {...handlers}
      />,
    );
    expect(screen.queryByTestId("best-time")).toBeNull();
    expect(screen.queryByTestId("stop-weather")).toBeNull();
    expect(screen.queryByTestId("light-warning")).toBeNull();
    expect(useWeatherLine).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("stop-role").map((el) => el.textContent)).toEqual(["Start", "End"]);
    expect(screen.getByRole("radiogroup", { name: "Priority for B" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Priority for A" })).toBeNull();
  });

  it("wraps at narrow widths", () => {
    render(<TripPlanList stops={[stop("a", "A very long stop name indeed", { lightPref: "golden" })]} optimized={false} bestTimes={[null]} {...handlers} />);
    expect(screen.getByTestId("trip-row").className).toContain("flex-wrap");
    expect(screen.getByRole("radiogroup").className).toContain("max-w-full");
  });
});
