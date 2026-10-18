// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Stop } from "@/lib/types";
import { reorderIds, StopList } from "./StopList";

const stop = (id: string, name: string, extra: Partial<Stop> = {}): Stop => ({
  id, tripId: "t1", order: 0, name, lat: 37, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...extra,
});
const handlers = { onReorder: vi.fn(), onDelete: vi.fn(), onSelect: vi.fn() };

describe("reorderIds", () => {
  it("moves the active id to the over position", () => {
    expect(reorderIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
  it("returns null for no-op or unknown ids", () => {
    expect(reorderIds(["a", "b"], "a", "a")).toBeNull();
    expect(reorderIds(["a", "b"], "x", "a")).toBeNull();
  });
});

describe("StopList", () => {
  it("disables browser touch panning on the drag handle so touch drags reach dnd-kit", () => {
    render(<StopList stops={[stop("a", "A")]} {...handlers} />);
    expect(screen.getByTestId("drag-handle").className).toContain("touch-none");
  });

  it("shows an empty state", () => {
    render(<StopList stops={[]} {...handlers} />);
    expect(screen.getByText("No stops yet.")).toBeTruthy();
  });

  it("calls handlers for delete and select", async () => {
    render(<StopList stops={[stop("a", "Tunnel View")]} {...handlers} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Tunnel View" }));
    await userEvent.click(screen.getByRole("button", { name: "1. Tunnel View" }));
    expect(handlers.onDelete).toHaveBeenCalledWith("a");
    expect(handlers.onSelect).toHaveBeenCalledWith("a");
  });

  it("rows show only the photo, the name, reorder and delete", () => {
    render(<StopList stops={[stop("a", "A", { notes: "Bring a tripod", priority: "must", lightPref: "sunrise" }), stop("b", "B")]} {...handlers} />);
    const row = screen.getAllByTestId("stop-row")[0]!;
    expect(within(row).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["1. A", "Reorder A", "Delete A"]);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByTestId("best-time")).toBeNull();
    expect(screen.queryByTestId("stop-weather")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByTestId("stop-role")).toBeNull();
    expect(screen.queryByText("Bring a tripod")).toBeNull();
  });

  it("keeps the sr-only position before the name", () => {
    render(<StopList stops={[stop("a", "A")]} {...handlers} />);
    expect(screen.getByRole("button", { name: "1. A" }).textContent).toBe("1. A");
  });

  it("after a delete moves focus to the next row's name (the last row's, or the list when empty)", () => {
    const three = [stop("a", "A"), stop("b", "B"), stop("c", "C")];
    const { rerender } = render(<StopList stops={three} {...handlers} />);
    screen.getByRole("button", { name: "Delete B" }).focus();
    rerender(<StopList stops={[three[0]!, three[2]!]} {...handlers} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "2. C" }));
    screen.getByRole("button", { name: "Delete C" }).focus();
    rerender(<StopList stops={[three[0]!]} {...handlers} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "1. A" }));
    screen.getByRole("button", { name: "Delete A" }).focus();
    rerender(<StopList stops={[]} {...handlers} />);
    expect(document.activeElement?.textContent).toBe("No stops yet.");
  });

  it("does not steal focus from elsewhere when a stop disappears", () => {
    const two = [stop("a", "A"), stop("b", "B")];
    const { rerender } = render(<><input aria-label="other" /><StopList stops={two} {...handlers} /></>);
    screen.getByLabelText("other").focus();
    rerender(<><input aria-label="other" /><StopList stops={[two[0]!]} {...handlers} /></>);
    expect(document.activeElement).toBe(screen.getByLabelText("other"));
  });
});
