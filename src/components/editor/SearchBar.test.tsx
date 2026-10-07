// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ api: { geocode: vi.fn() } }));
import { api } from "@/lib/api-client";
import type { Place } from "@/lib/types";
import { SearchBar } from "./SearchBar";

const fresno: Place = { name: "Fresno, California", lat: 36.74, lng: -119.79 };
const input = () => screen.getByRole("combobox", { name: "Search for a place" });

describe("SearchBar", () => {
  afterEach(() => vi.mocked(api.geocode).mockReset());

  it("searches as you type, biased to the map centre, and selects a result", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ places: [fresno] });
    const onSelect = vi.fn();
    render(<SearchBar getProximity={() => ({ lat: 37, lng: -119 })} onSelect={onSelect} />);
    await userEvent.type(input(), "Fres");
    await userEvent.click(await screen.findByRole("button", { name: "Fresno, California" }));
    expect(api.geocode).toHaveBeenCalledTimes(1); // typing was debounced into one request
    expect(api.geocode).toHaveBeenCalledWith("Fres", { lat: 37, lng: -119 });
    expect(onSelect).toHaveBeenCalledWith(fresno);
    expect((input() as HTMLInputElement).value).toBe("");
  });

  it("does not search for fewer than 2 characters", async () => {
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "F");
    await new Promise((r) => setTimeout(r, 400));
    expect(api.geocode).not.toHaveBeenCalled();
  });

  it("ignores a stale response that arrives after a newer search", async () => {
    let resolveFirst!: (v: { places: Place[] }) => void;
    vi.mocked(api.geocode)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ places: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fr");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(1));
    await userEvent.type(input(), "e");
    expect(await screen.findByRole("button", { name: "Fresno, California" })).toBeTruthy();
    await act(async () => resolveFirst({ places: [{ name: "Frankfurt", lat: 50, lng: 8 }] }));
    expect(screen.queryByRole("button", { name: "Frankfurt" })).toBeNull();
  });

  it("shows no-match and error messages", async () => {
    vi.mocked(api.geocode).mockResolvedValueOnce({ places: [] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "zzzz");
    expect(await screen.findByText("No matches found")).toBeTruthy();
    vi.mocked(api.geocode).mockRejectedValueOnce(new Error("Place search failed. Please try again."));
    await userEvent.type(input(), "y");
    expect(await screen.findByText("Place search failed. Please try again.")).toBeTruthy();
  });

  it("clears on Escape", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ places: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await screen.findByRole("button", { name: "Fresno, California" });
    await userEvent.keyboard("{Escape}");
    expect((input() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Fresno, California" })).toBeNull();
  });
});
