// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/lib/api-client", () => ({ api: { createTrip: vi.fn() } }));
vi.mock("@/components/PlaceSearch", () => ({
  PlaceSearch: ({ label, onChange }: { label: string; onChange: (p: { name: string; lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onChange({ name: `${label} place`, lat: 37, lng: -119 })}>pick {label}</button>
  ),
}));
import { api } from "@/lib/api-client";
import { NewTripForm } from "./NewTripForm";

describe("NewTripForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires start and end before submitting", async () => {
    render(<NewTripForm today="2026-07-01" />);
    await userEvent.type(screen.getByLabelText("Trip name"), "Sierra loop");
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Choose a start and an end location");
    expect(api.createTrip).not.toHaveBeenCalled();
  });

  it("creates the trip and opens the editor", async () => {
    vi.mocked(api.createTrip).mockResolvedValue({ trip: { id: "t9" } as never });
    render(<NewTripForm today="2026-07-01" />);
    await userEvent.type(screen.getByLabelText("Trip name"), "Sierra loop");
    await userEvent.click(screen.getByRole("button", { name: "pick Start" }));
    await userEvent.click(screen.getByRole("button", { name: "pick End" }));
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
    expect(api.createTrip).toHaveBeenCalledWith({
      name: "Sierra loop",
      plannedDate: "2026-07-01",
      start: { name: "Start place", lat: 37, lng: -119 },
      end: { name: "End place", lat: 37, lng: -119 },
    });
    expect(push).toHaveBeenCalledWith("/trips/t9");
  });
});
