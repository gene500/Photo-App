// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ api: { geocode: vi.fn() } }));
import { api } from "@/lib/api-client";
import { PlaceSearch } from "./PlaceSearch";

describe("PlaceSearch", () => {
  afterEach(() => vi.mocked(api.geocode).mockReset());

  it("searches and selects a place", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ places: [{ name: "Fresno, CA", lat: 36.7, lng: -119.8 }] });
    const onChange = vi.fn();
    render(<PlaceSearch label="Start" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Start search" }), "Fresno");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.click(await screen.findByRole("button", { name: "Fresno, CA" }));
    expect(api.geocode).toHaveBeenCalledWith("Fresno");
    expect(onChange).toHaveBeenCalledWith({ name: "Fresno, CA", lat: 36.7, lng: -119.8 });
  });

  it("shows the selected place and search errors", async () => {
    vi.mocked(api.geocode).mockRejectedValue(new Error("Place search failed. Please try again."));
    render(<PlaceSearch label="End" value={{ name: "Lee Vining", lat: 38, lng: -119 }} onChange={() => {}} />);
    expect(screen.getByText("Selected: Lee Vining")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "End search" }), "Mono");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Place search failed. Please try again.")).toBeTruthy();
  });
});
