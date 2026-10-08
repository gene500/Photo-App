// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Trip } from "@/lib/types";
import { TripHeader } from "./TripHeader";

const trip: Trip = {
  id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, shareToken: null,
};

describe("TripHeader", () => {
  it("summarizes the trip", () => {
    render(<TripHeader trip={trip} onSave={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Sierra loop" })).toBeTruthy();
    expect(screen.getByText("Planned for 2026-07-01")).toBeTruthy();
  });

  it("edits and saves name and date", async () => {
    const onSave = vi.fn(async () => {});
    render(<TripHeader trip={trip} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    const name = screen.getByLabelText("Trip name");
    await userEvent.clear(name);
    await userEvent.type(name, "Eastern Sierra");
    await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Eastern Sierra", plannedDate: "2026-07-01" });
    expect(screen.getByRole("button", { name: "Edit trip" })).toBeTruthy();
  });

  it("keeps the form open and shows the error when saving fails", async () => {
    render(<TripHeader trip={trip} onSave={vi.fn(async () => { throw new Error("Trip not found"); })} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Trip not found");
  });

  it("shows the Share control only when the editor wires it up, and reports changes", async () => {
    const { rerender } = render(<TripHeader trip={trip} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    const onShareChange = vi.fn();
    rerender(<TripHeader trip={trip} onSave={vi.fn()} onShareChange={onShareChange} />);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("shows the Export control only when export data is given", () => {
    const { rerender } = render(<TripHeader trip={trip} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    rerender(<TripHeader trip={trip} onSave={vi.fn()} exportData={{ stops: [], route: null }} />);
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
