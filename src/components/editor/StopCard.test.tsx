// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Stop } from "@/lib/types";
import { StopCard } from "./StopCard";

const stop: Stop = { id: "s1", tripId: "t1", order: 0, name: "Tunnel View", lat: 37.7, lng: -119.7, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", dwellMinutes: 30 };
const base = { stop, bestTime: { window: "golden hour" as const, at: new Date("2026-07-02T02:45:00Z") }, onToggleVisited: vi.fn(), onOpenDetails: vi.fn(), onClose: vi.fn() };

describe("StopCard", () => {
  it("shows the name, best time and estimated arrival", () => {
    render(<StopCard {...base} arrival={new Date("2026-07-01T16:30:00Z")} />);
    expect(screen.getByText("Tunnel View")).toBeTruthy();
    expect(screen.getByText(/Golden hour ·/)).toBeTruthy();
    expect(screen.getByText(/Arrive ~/)).toBeTruthy();
  });

  it("omits the arrival when there is no route estimate", () => {
    render(<StopCard {...base} arrival={null} />);
    expect(screen.queryByText(/Arrive ~/)).toBeNull();
  });

  it("toggles visited, opens details and closes", async () => {
    const onToggleVisited = vi.fn();
    const onOpenDetails = vi.fn();
    const onClose = vi.fn();
    render(<StopCard {...base} arrival={null} onToggleVisited={onToggleVisited} onOpenDetails={onOpenDetails} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Visited"));
    expect(onToggleVisited).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Open details" }));
    expect(onOpenDetails).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
