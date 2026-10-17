// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createItineraryPdf, loadWeatherLines, saveBlob } from "@/lib/itinerary-download";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { SETTINGS_KEY } from "@/lib/settings";
import type { PublicTrip } from "@/lib/types";
import { SharedTripView } from "./SharedTripView";

vi.mock("@/lib/itinerary-download", () => ({
  createItineraryPdf: vi.fn(),
  loadWeatherLines: vi.fn(),
  saveBlob: vi.fn(),
  mapTokenFromEnv: vi.fn(() => null),
}));

const stop = (order: number, name: string, extra: Partial<PublicTrip["stops"][number]> = {}): PublicTrip["stops"][number] => ({
  order, name, lat: 36 + order * 0.3, lng: -120, notes: null, source: "manual", visited: false, lightPref: "any", dwellMinutes: 30,
  shotNotes: null, shotChecklist: [], priority: "normal", ...extra,
});

const trip: PublicTrip = {
  name: "Coast run",
  plannedDate: "2026-07-01",
  departAt: null,
  stops: [
    stop(0, "First view", { notes: "Park by the gate" }),
    stop(1, "Second view", { shotNotes: "Use a polarizer", shotChecklist: [{ text: "Wide shot", done: true }, { text: "Detail", done: false }], lightPref: "sunset" }),
  ],
};

describe("SharedTripView", () => {
  it("shows the trip read-only: name, numbered stops, notes and shot list, a pin per stop", () => {
    render(<SharedTripView trip={trip} />);
    expect(screen.getByRole("heading", { name: "Coast run" })).toBeTruthy();
    expect(screen.getByText(/view only/i)).toBeTruthy();
    const rows = screen.getAllByTestId("shared-stop");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("First view");
    expect(rows[0]!.textContent).toContain("Park by the gate");
    expect(rows[1]!.textContent).toContain("Use a polarizer");
    expect(rows[1]!.textContent).toContain("Wide shot");
    expect(screen.getByRole("button", { name: "Stop 2: Second view" })).toBeTruthy();
    expect(screen.getByText("Best at sunset")).toBeTruthy();
  });

  it("labels High and Must-have stops but not Normal ones", () => {
    const t = { ...trip, stops: [stop(0, "A", { lightPref: "sunset", priority: "must" }), stop(1, "B", { lightPref: "sunset", priority: "high" }), stop(2, "C", { lightPref: "sunset" })] };
    render(<SharedTripView trip={t} />);
    const rows = screen.getAllByTestId("shared-stop").map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("Must-have");
    expect(rows[1]).toContain("High priority");
    expect(rows[2]).not.toMatch(/Must-have|High priority/);
  });

  it("drops the straight-line caveat when a real driving route is supplied", () => {
    const route = { geometry: [[-120, 36.3], [-120, 36.6]] as [number, number][], legs: [{ distance: 40000, duration: 2400 }], distance: 40000, duration: 2400 };
    const { rerender } = render(<SharedTripView trip={trip} />);
    expect(screen.getByText(/straight-line distances/i)).toBeTruthy();
    rerender(<SharedTripView trip={trip} route={route} />);
    expect(screen.queryByText(/straight-line distances/i)).toBeNull();
  });

  it("offers no editing controls and renders no images", () => {
    const { container } = render(<SharedTripView trip={trip} />);
    expect(container.querySelector("input, textarea, img")).toBeNull();
    for (const label of [/delete/i, /add stop/i, /visited/i, /edit/i, /share/i]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("handles a trip with no stops", () => {
    render(<SharedTripView trip={{ ...trip, stops: [] }} />);
    expect(screen.getByText("No stops yet.")).toBeTruthy();
  });
});

describe("SharedTripView with saved settings", () => {
  it("honours the 24-hour clock without needing an account", async () => {
    installMemoryStorage().setItem(SETTINGS_KEY, JSON.stringify({ timeFormat: "24h" }));
    vi.resetModules();
    const { SettingsProvider } = await import("@/components/settings/SettingsProvider");
    const { SharedTripView: View } = await import("./SharedTripView");
    render(<SettingsProvider><View trip={{ ...trip, departAt: "2026-07-01T14:05:00Z" }} /></SettingsProvider>);
    expect(screen.getAllByTestId("shared-time").every((el) => !/[AP]M/.test(el.textContent ?? ""))).toBe(true);
    expect(document.body.textContent).not.toMatch(/Starts \d{1,2}:\d{2} [AP]M/);
  });
});

describe("SharedTripView Download PDF", () => {
  beforeEach(() => {
    vi.mocked(createItineraryPdf).mockReset();
    vi.mocked(saveBlob).mockReset();
    vi.mocked(loadWeatherLines).mockReset();
  });

  it("is not offered with 0 or 1 stops", () => {
    const { rerender } = render(<SharedTripView trip={{ ...trip, stops: [] }} />);
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    rerender(<SharedTripView trip={{ ...trip, stops: [stop(0, "Only")] }} />);
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
  });

  it("builds the PDF without weather and saves it", async () => {
    const blob = new Blob(["x"]);
    vi.mocked(createItineraryPdf).mockResolvedValue(blob);
    const route = { geometry: [[-120, 36.3], [-120, 36.6]] as [number, number][], legs: [{ distance: 40000, duration: 2400 }], distance: 40000, duration: 2400 };
    render(<SharedTripView trip={trip} route={route} />);
    await userEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    expect(createItineraryPdf).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createItineraryPdf).mock.calls[0]![0];
    expect(arg.input.stops).toHaveLength(2);
    expect(arg.input.stops.every((s) => s.weather === null)).toBe(true);
    expect(arg.input.routeLine).toBeTruthy();
    expect(loadWeatherLines).not.toHaveBeenCalled();
    expect(saveBlob).toHaveBeenCalledWith(blob, "Coast-run-itinerary.pdf");
  });

  it("has no route line when routing was unavailable", async () => {
    vi.mocked(createItineraryPdf).mockResolvedValue(new Blob(["x"]));
    render(<SharedTripView trip={trip} />);
    await userEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    expect(vi.mocked(createItineraryPdf).mock.calls[0]![0].input.routeLine).toBeNull();
  });

  it("shows Preparing PDF... and disables the button while pending", async () => {
    let resolve!: (b: Blob) => void;
    vi.mocked(createItineraryPdf).mockReturnValue(new Promise<Blob>((r) => { resolve = r; }));
    render(<SharedTripView trip={trip} />);
    await userEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    const busy = (await screen.findByRole("button", { name: "Preparing PDF..." })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => resolve(new Blob(["x"])));
    expect(saveBlob).toHaveBeenCalledTimes(1);
  });

  it("shows an alert when it fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createItineraryPdf).mockRejectedValue(new Error("boom"));
    render(<SharedTripView trip={trip} />);
    await userEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not create the PDF. Try again.");
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
