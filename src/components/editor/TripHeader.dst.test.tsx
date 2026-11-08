// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Trip } from "@/lib/types";
import { TripHeader } from "./TripHeader";

// The start time is read in the viewer's zone; pin one so the suite gives the same answer on any machine.
process.env.TZ = "America/Los_Angeles";

const base: Trip = { id: "t1", name: "Sierra loop", plannedDate: "2026-10-30", departAt: "2026-10-30T14:00:00.000Z", shareToken: null }; // 07:00 PDT

async function changeDate(trip: Trip, date: string) {
  const onSave = vi.fn(async () => {});
  render(<TripHeader trip={trip} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
  fireEvent.change(screen.getByLabelText("Planned date"), { target: { value: date } });
  await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
  return onSave;
}

describe("TripHeader date change across a DST change", () => {
  it("keeps the viewer's local clock time on the new day (07:00 PDT stays 07:00 PST)", async () => {
    const onSave = await changeDate(base, "2026-11-06");
    expect(onSave).toHaveBeenCalledWith({ plannedDate: "2026-11-06", departAt: "2026-11-06T15:00:00.000Z" });
  });

  it("falls back to whole UTC days when the clock time would be off the first stop's solar day", async () => {
    const onSave = vi.fn(async () => {});
    const trip: Trip = { ...base, plannedDate: "2026-11-02", departAt: "2026-11-02T08:30:00.000Z" }; // 00:30 PST
    render(<TripHeader trip={trip} onSave={onSave} exportData={{ stops: [{ name: "A", lat: 34, lng: -118.2, notes: null }], route: null }} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    fireEvent.change(screen.getByLabelText("Planned date"), { target: { value: "2026-10-20" } });
    await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect(onSave).toHaveBeenCalledWith({ plannedDate: "2026-10-20", departAt: "2026-10-20T08:30:00.000Z" });
  });

  it("is unchanged without a DST change (whole days)", async () => {
    const onSave = await changeDate(base, "2026-10-20");
    expect(onSave).toHaveBeenCalledWith({ plannedDate: "2026-10-20", departAt: "2026-10-20T14:00:00.000Z" });
  });

  it("sends no departAt when none is saved", async () => {
    const onSave = await changeDate({ ...base, departAt: null }, "2026-11-06");
    expect(onSave).toHaveBeenCalledWith({ plannedDate: "2026-11-06" });
  });
});
