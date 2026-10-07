// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/lib/api-client", () => ({ api: { createTrip: vi.fn() } }));
import { api } from "@/lib/api-client";
import { NewTripForm } from "./NewTripForm";

describe("NewTripForm", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("defaults the date to the viewer's local day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 1, 23, 30)); // late evening local time
    render(<NewTripForm />);
    expect((screen.getByLabelText("Planned date") as HTMLInputElement).value).toBe("2026-07-01");
  });

  it("creates the trip and opens the editor", async () => {
    vi.mocked(api.createTrip).mockResolvedValue({ trip: { id: "t9" } as never });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 1, 12));
    render(<NewTripForm />);
    await userEvent.type(screen.getByLabelText("Trip name"), "Sierra loop");
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
    expect(api.createTrip).toHaveBeenCalledWith({ name: "Sierra loop", plannedDate: "2026-07-01" });
    expect(push).toHaveBeenCalledWith("/trips/t9");
  });
});
