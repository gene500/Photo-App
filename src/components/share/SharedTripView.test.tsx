// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicTrip } from "@/lib/types";
import { SharedTripView } from "./SharedTripView";

const stop = (order: number, name: string, extra: Partial<PublicTrip["stops"][number]> = {}): PublicTrip["stops"][number] => ({
  order, name, lat: 36 + order * 0.3, lng: -120, notes: null, source: "manual", visited: false, lightPref: "any", dwellMinutes: 30,
  shotNotes: null, shotChecklist: [], ...extra,
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
