// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Stop } from "@/lib/types";
import { listCollision, reorderIds, StopList } from "./StopList";

const stop = (id: string, name: string, extra: Partial<Stop> = {}): Stop => ({
  id, tripId: "t1", order: 0, name, lat: 37, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...extra,
});
const handlers = { onReorder: vi.fn(), onDelete: vi.fn(), onSelect: vi.fn() };

describe("listCollision (drag released outside the list cancels)", () => {
  const rect = (top: number) => ({ top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40 });
  const droppableRects = new Map([["a", rect(0)], ["b", rect(40)]]) as never;
  const base = { droppableRects, droppableContainers: [{ id: "a", rect: { current: rect(0) } }, { id: "b", rect: { current: rect(40) } }], active: {}, collisionRect: rect(45) } as never;
  it("has no target when the pointer is outside the rows", () => {
    expect(listCollision({ ...(base as object), pointerCoordinates: { x: 500, y: 20 } } as never)).toEqual([]);
    expect(listCollision({ ...(base as object), pointerCoordinates: { x: 100, y: 200 } } as never)).toEqual([]);
  });
  it("picks the closest row when the pointer is over the list, and for keyboard drags", () => {
    expect(listCollision({ ...(base as object), pointerCoordinates: { x: 100, y: 60 } } as never)[0]?.id).toBe("b");
    expect(listCollision({ ...(base as object), pointerCoordinates: null } as never)[0]?.id).toBe("b");
  });
});

describe("reorderIds", () => {
  it("moves the active id to the over position", () => {
    expect(reorderIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
  it("returns null for no-op or unknown ids", () => {
    expect(reorderIds(["a", "b"], "a", "a")).toBeNull();
    expect(reorderIds(["a", "b"], "x", "a")).toBeNull();
  });
});

describe("reorderIds with visited stops pinned", () => {
  it("never moves a visited stop", () => {
    expect(reorderIds(["a", "b", "c", "d"], "a", "d", 2)).toBeNull();
    expect(reorderIds(["a", "b", "c", "d"], "b", "d", 2)).toBeNull();
  });
  it("treats a drop onto a visited stop as the first unvisited place", () => {
    expect(reorderIds(["a", "b", "c", "d"], "d", "a", 2)).toEqual(["a", "b", "d", "c"]);
    expect(reorderIds(["a", "b", "c", "d"], "c", "b", 2)).toBeNull();
  });
  it("still moves unvisited stops among themselves", () => {
    expect(reorderIds(["a", "b", "c", "d"], "c", "d", 2)).toEqual(["a", "b", "d", "c"]);
  });
});

describe("StopList", () => {
  it("disables the drag handle of visited rows with a reason", () => {
    render(<StopList stops={[stop("a", "A", { visited: true }), stop("b", "B"), stop("c", "C")]} {...handlers} />);
    const a = screen.getByRole("button", { name: "A is visited and stays in place" }) as HTMLButtonElement;
    expect(a.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reorder B" }) as HTMLButtonElement).disabled).toBe(false);
  });

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

  it("announces a keyboard pick-up by stop name, never by database id", async () => {
    render(<StopList stops={[stop("cmvq1xyz", "Alpha"), stop("cmvq2xyz", "Beta")]} {...handlers} />);
    screen.getByRole("button", { name: "Reorder Beta" }).focus();
    await userEvent.keyboard(" ");
    const live = document.querySelector('[role="status"][aria-live]');
    expect(live?.textContent).toBe("Picked up Beta.");
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector('[role="status"][aria-live]')?.textContent).not.toMatch(/cmvq/);
  });
});
