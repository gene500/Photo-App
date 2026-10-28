// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("shows the date and the stop count on one line", () => {
    render(<TripHeader trip={trip} stopCount={9} onSave={vi.fn()} />);
    expect(screen.getByText("Planned for 2026-07-01").parentElement?.textContent).toBe("Planned for 2026-07-01 · 9 stops");
  });

  it("edits and saves name and date", async () => {
    const onSave = vi.fn(async () => {});
    render(<TripHeader trip={trip} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    const name = screen.getByLabelText("Trip name");
    await userEvent.clear(name);
    await userEvent.type(name, "Eastern Sierra");
    await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
    // The unchanged date is not re-sent, so a rename cannot reset the trip's start time.
    expect(onSave).toHaveBeenCalledWith({ name: "Eastern Sierra" });
    expect(screen.getByRole("button", { name: "Edit trip" })).toBeTruthy();
  });

  it("sends nothing when neither field changed", async () => {
    const onSave = vi.fn(async () => {});
    render(<TripHeader trip={trip} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit trip" })).toBeTruthy();
  });

  it("sends the date when it changed", async () => {
    const onSave = vi.fn(async () => {});
    render(<TripHeader trip={trip} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    fireEvent.change(screen.getByLabelText("Planned date"), { target: { value: "2026-07-05" } });
    await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect(onSave).toHaveBeenCalledWith({ plannedDate: "2026-07-05" });
  });

  it("keeps the form open and shows the error when saving fails", async () => {
    render(<TripHeader trip={trip} onSave={vi.fn(async () => { throw new Error("Trip not found"); })} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    await userEvent.type(screen.getByLabelText("Trip name"), "!");
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

  it("keeps the name and the buttons on one row, wrapping only when the name would get too narrow", () => {
    render(<TripHeader trip={trip} onSave={vi.fn()} onShareChange={vi.fn()} exportData={{ stops: [], route: null }} />);
    const heading = screen.getByRole("heading", { name: "Sierra loop" });
    expect(heading.getAttribute("title")).toBe("Sierra loop");
    const row = heading.parentElement!;
    expect(row.className).toMatch(/\bflex-wrap\b/);
    expect(heading.style.minWidth).toBe("8.58ch"); // 11 characters (under the 12-character cap), in ch so it scales with the text size
    const buttons = screen.getByRole("button", { name: "Edit trip" }).parentElement!;
    expect(buttons.parentElement).toBe(row);
    expect(buttons.className).toMatch(/shrink-0/);
    expect(buttons.contains(screen.getByRole("button", { name: "Export" }))).toBe(true);
    expect(buttons.contains(screen.getByRole("button", { name: "Share" }))).toBe(true);
  });

  it("caps the name's minimum width at 12 characters, so a very long name wraps beside the buttons without shrinking to a sliver", () => {
    render(<TripHeader trip={{ ...trip, name: "A".repeat(68) }} onSave={vi.fn()} />);
    expect(screen.getByRole("heading").style.minWidth).toBe("9.36ch");
    expect(screen.getByRole("heading").className).toMatch(/break-words/);
  });

  it("gives the Edit trip form its own scroll on phones, so Save is reachable in landscape", () => {
    render(<TripHeader trip={trip} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    const form = screen.getByRole("button", { name: "Save trip" }).closest("form")!;
    expect(form.className).toMatch(/max-lg:overflow-y-auto/);
    expect(form.className).toMatch(/max-lg:max-h-\[40dvh\]/);
  });

  it("labels the edit button with the short visible text Edit, keeping the full accessible name", () => {
    render(<TripHeader trip={trip} onSave={vi.fn()} />);
    const edit = screen.getByRole("button", { name: "Edit trip" });
    expect(edit.textContent).toBe("Edit");
    expect(edit.getAttribute("aria-label")).toBe("Edit trip");
  });

  it("only asks for as much room as a short name needs", () => {
    render(<TripHeader trip={{ ...trip, name: "Zion" }} onSave={vi.fn()} onShareChange={vi.fn()} exportData={{ stops: [], route: null }} />);
    expect(screen.getByRole("heading", { name: "Zion" }).style.minWidth).toBe("3.12ch");
  });

  it("moves focus into the name field on Edit and back to Edit on Save and on Cancel", async () => {
    render(<TripHeader trip={trip} onSave={vi.fn(async () => {})} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Trip name"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit trip" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    await userEvent.type(screen.getByLabelText("Trip name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit trip" }));
  });

  it("keeps focus on Save trip when the save fails (spaces-only name)", async () => {
    render(<TripHeader trip={trip} onSave={vi.fn(async () => { throw new Error("Trip name is required"); })} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    await userEvent.clear(screen.getByLabelText("Trip name"));
    await userEvent.type(screen.getByLabelText("Trip name"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/required/);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save trip" }));
  });

  it("cancels the edit form on Escape and puts focus back on Edit", async () => {
    const onSave = vi.fn(async () => {});
    render(<TripHeader trip={trip} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Trip name")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit trip" }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
