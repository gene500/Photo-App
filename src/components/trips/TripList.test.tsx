// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { RefreshWhenStale } from "@/components/RefreshWhenStale";
import { listTripCopies, saveTripCopy } from "@/lib/offline-store";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/lib/api-client", async (orig) => ({ ...(await orig<typeof import("@/lib/api-client")>()), api: { deleteTrip: vi.fn() } }));
import { ApiError, api } from "@/lib/api-client";
import type { TripSummary } from "@/lib/types";
import { TripList } from "./TripList";

const trip: TripSummary = {
  id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, shareToken: null, stopCount: 3, updatedAt: "2026-06-01T00:00:00Z",
};

const copy = (id: string) => ({ id, name: id, plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });

const confirmDelete = () => userEvent.click(within(screen.getByRole("alertdialog", { name: "Delete trip?" })).getByRole("button", { name: "Delete" }));

describe("TripList", () => {
  beforeEach(() => {
    installMemoryStorage().setItem("rtpp.offline.owner", "u1");
  });

  it("lets a long trip name wrap to two lines (not one-line truncation) and keeps the full name in a title", () => {
    const long = "W".repeat(60);
    render(<TripList trips={[{ ...trip, name: long }]} />);
    const name = screen.getByTitle(long);
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).toContain("break-words");
    expect(name.className).not.toContain("truncate");
    expect(screen.getByText("3 stops")).toBeTruthy();
  });

  it("drops the offline copy of a trip when it is deleted", async () => {
    vi.mocked(api.deleteTrip).mockResolvedValue(undefined);
    saveTripCopy(copy("t1"));
    render(<TripList trips={[trip]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Sierra loop" }));
    await confirmDelete();
    expect(listTripCopies()).toEqual([]);
  });

  it("treats a 404 (already deleted elsewhere) as success: removes the copy and refreshes", async () => {
    refresh.mockClear();
    vi.mocked(api.deleteTrip).mockReset().mockRejectedValue(new ApiError(404, "Trip not found"));
    saveTripCopy(copy("t1"));
    render(<TripList trips={[trip]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Sierra loop" }));
    await confirmDelete();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(listTripCopies()).toEqual([]);
    expect(refresh).toHaveBeenCalled();
  });

  it("sends one delete (and asks once) when Delete is clicked twice while it is in flight", async () => {
    let finish!: () => void;
    vi.mocked(api.deleteTrip).mockReset().mockReturnValue(new Promise<void>((r) => { finish = r; }));
    render(<TripList trips={[trip]} />);
    const button = screen.getByRole("button", { name: "Delete Sierra loop" });
    await userEvent.dblClick(button);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    await confirmDelete();
    expect(api.deleteTrip).toHaveBeenCalledTimes(1);
    // The row is disabled while the delete runs, so a further press opens no dialog.
    await userEvent.click(button);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.deleteTrip).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).getAttribute("aria-disabled")).toBe("true");
    finish();
    await vi.waitFor(() => expect((button as HTMLButtonElement).getAttribute("aria-disabled")).toBeNull());
  });

  it("prunes offline copies of trips the server no longer lists, even when the list is empty", () => {
    saveTripCopy(copy("t1"));
    saveTripCopy(copy("gone"));
    const { unmount } = render(<TripList trips={[trip]} />);
    expect(listTripCopies().map((e) => e.id)).toEqual(["t1"]);
    unmount();
    render(<TripList trips={[]} />);
    expect(listTripCopies()).toEqual([]);
  });

  it("does not prune on a cached (stale) render that lacks a new trip, only once a fresh render arrives", () => {
    saveTripCopy(copy("t1"));
    const page = (stamp: number, trips: TripSummary[]) => (<><RefreshWhenStale renderedAt={stamp} /><TripList trips={trips} renderedAt={stamp} /></>);
    render(page(9101, [trip])).unmount(); // the first, fresh render of /trips
    saveTripCopy(copy("new")); // a trip created (and saved offline) since
    // Back restores the cached render (same stamp, list without the new trip): nothing may be pruned.
    const { rerender } = render(page(9101, [trip]));
    expect(listTripCopies().map((e) => e.id).sort()).toEqual(["new", "t1"]);
    // The refresh arrives with a new stamp and the real list: now the copies are reconciled.
    rerender(page(9102, [trip, { ...trip, id: "new" }]));
    expect(listTripCopies().map((e) => e.id).sort()).toEqual(["new", "t1"]);
    rerender(page(9103, [trip]));
    expect(listTripCopies().map((e) => e.id)).toEqual(["t1"]);
  });

  it("shows an empty state", () => {
    render(<TripList trips={[]} />);
    expect(screen.getByText("No trips yet. Create one below.")).toBeTruthy();
  });

  it("makes the whole row (name and details) one link, with Delete outside it", () => {
    render(<TripList trips={[trip]} />);
    const link = screen.getByRole("link", { name: /Sierra loop/ });
    expect(link.getAttribute("href")).toBe("/trips/t1");
    expect(link.textContent).toContain("3 stops");
    expect(link.querySelector("time")?.getAttribute("datetime")).toBe("2026-07-01");
    expect(link.querySelector("time")?.textContent).toBe("Jul1");
    expect(link.contains(screen.getByRole("button", { name: "Delete Sierra loop" }))).toBe(false);
  });

  it("deletes after confirmation and refreshes", async () => {
    vi.mocked(api.deleteTrip).mockResolvedValue(undefined);
    render(<TripList trips={[trip]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Sierra loop" }));
    await confirmDelete();
    expect(api.deleteTrip).toHaveBeenCalledWith("t1");
    expect(refresh).toHaveBeenCalled();
  });

  describe("keyboard focus after a confirmed delete", () => {
    const trips = ["a", "b", "c"].map((id) => ({ ...trip, id, name: `Trip ${id}` }));
    async function remove(list: TripSummary[], name: string) {
      vi.mocked(api.deleteTrip).mockReset().mockResolvedValue(undefined);
      render(<main><h1 tabIndex={-1}>Your trips</h1><TripList trips={list} /></main>);
      await userEvent.click(screen.getByRole("button", { name: `Delete ${name}` }));
      await confirmDelete();
      await vi.waitFor(() => expect(api.deleteTrip).toHaveBeenCalled());
    }

    it("moves to the next row's link", async () => {
      await remove(trips, "Trip a");
      expect(document.activeElement).toBe(screen.getByRole("link", { name: /Trip b/ }));
    });

    it("moves to the previous row's link when the last row goes", async () => {
      await remove(trips, "Trip c");
      expect(document.activeElement).toBe(screen.getByRole("link", { name: /Trip b/ }));
    });

    it("moves to the page heading when the only row goes", async () => {
      await remove([trips[0]!], "Trip a");
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your trips" }));
    });
  });

  it("removes the first-stop marker of a deleted trip from localStorage", async () => {
    vi.mocked(api.deleteTrip).mockReset().mockResolvedValue(undefined);
    localStorage.setItem("autoFirstStop:t1", "1");
    localStorage.setItem("autoFirstStop:other", "1");
    render(<TripList trips={[trip]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Sierra loop" }));
    await confirmDelete();
    expect(localStorage.getItem("autoFirstStop:t1")).toBeNull();
    expect(localStorage.getItem("autoFirstStop:other")).toBe("1");
  });
});
