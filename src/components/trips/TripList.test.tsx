// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/lib/api-client", () => ({ api: { deleteTrip: vi.fn() } }));
import { api } from "@/lib/api-client";
import type { TripSummary } from "@/lib/types";
import { TripList } from "./TripList";

const trip: TripSummary = {
  id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, shareToken: null, stopCount: 3, updatedAt: "2026-06-01T00:00:00Z",
};

describe("TripList", () => {
  it("shows an empty state", () => {
    render(<TripList trips={[]} />);
    expect(screen.getByText("No trips yet. Create one below.")).toBeTruthy();
  });

  it("makes the whole row (name and details) one link, with Delete outside it", () => {
    render(<TripList trips={[trip]} />);
    const link = screen.getByRole("link", { name: /Sierra loop/ });
    expect(link.getAttribute("href")).toBe("/trips/t1");
    expect(link.textContent).toContain("2026-07-01 · 3 stops");
    expect(link.contains(screen.getByRole("button", { name: "Delete Sierra loop" }))).toBe(false);
  });

  it("deletes after confirmation and refreshes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.deleteTrip).mockResolvedValue(undefined);
    render(<TripList trips={[trip]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Sierra loop" }));
    expect(api.deleteTrip).toHaveBeenCalledWith("t1");
    expect(refresh).toHaveBeenCalled();
  });
});
