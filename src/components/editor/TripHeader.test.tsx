// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Trip } from "@/lib/types";
import { TripHeader } from "./TripHeader";

const trip: Trip = {
  id: "t1", name: "Sierra loop", plannedDate: "2026-07-01",
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
});
