// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/lib/api-client", () => ({ api: { createTrip: vi.fn() } }));
import { api } from "@/lib/api-client";
import { NewTripForm } from "./NewTripForm";

describe("NewTripForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the trip and opens the editor", async () => {
    vi.mocked(api.createTrip).mockResolvedValue({ trip: { id: "t9" } as never });
    render(<NewTripForm today="2026-07-01" />);
    await userEvent.type(screen.getByLabelText("Trip name"), "Sierra loop");
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
    expect(api.createTrip).toHaveBeenCalledWith({ name: "Sierra loop", plannedDate: "2026-07-01" });
    expect(push).toHaveBeenCalledWith("/trips/t9");
  });
});
