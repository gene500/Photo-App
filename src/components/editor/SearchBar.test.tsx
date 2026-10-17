// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ api: { geocode: vi.fn(), retrievePlace: vi.fn() } }));
import { api } from "@/lib/api-client";
import type { SearchSuggestion } from "@/lib/types";
import { SearchBar } from "./SearchBar";

const fresno: SearchSuggestion = { name: "Fresno, California", lat: 36.74, lng: -119.79 };
const bend: SearchSuggestion = { name: "Horseshoe Bend", subtitle: "viewpoint · Page, Arizona", mapboxId: "h1" };
const input = () => screen.getByRole("combobox", { name: "Search for a place" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("SearchBar", () => {
  afterEach(() => {
    vi.mocked(api.geocode).mockReset();
    vi.mocked(api.retrievePlace).mockReset();
  });

  it("searches as you type, biased to the map centre, and selects a result that already has coordinates", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    const onSelect = vi.fn();
    render(<SearchBar getProximity={() => ({ lat: 37, lng: -119 })} onSelect={onSelect} />);
    await userEvent.type(input(), "Fres");
    await userEvent.click(await screen.findByRole("button", { name: "Fresno, California" }));
    expect(api.geocode).toHaveBeenCalledTimes(1); // typing was debounced into one request
    expect(api.geocode).toHaveBeenCalledWith("Fres", expect.stringMatching(UUID), { lat: 37, lng: -119 });
    expect(onSelect).toHaveBeenCalledWith({ name: "Fresno, California", lat: 36.74, lng: -119.79 });
    expect(api.retrievePlace).not.toHaveBeenCalled();
    expect((input() as HTMLInputElement).value).toBe("");
  });

  it("shows the subtitle and retrieves coordinates with the search session when a landmark is picked", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [bend] });
    vi.mocked(api.retrievePlace).mockResolvedValue({ place: { name: "Horseshoe Bend, Page, Arizona", lat: 36.88, lng: -111.51 } });
    const onSelect = vi.fn();
    render(<SearchBar getProximity={() => null} onSelect={onSelect} />);
    await userEvent.type(input(), "Horseshoe");
    expect(await screen.findByText("viewpoint · Page, Arizona")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Horseshoe Bend/ }));
    const session = vi.mocked(api.geocode).mock.calls[0][1];
    expect(api.retrievePlace).toHaveBeenCalledWith("h1", session);
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith({ name: "Horseshoe Bend, Page, Arizona", lat: 36.88, lng: -111.51 }));
    expect((input() as HTMLInputElement).value).toBe("");
    // A new search after a pick gets a fresh session.
    await userEvent.type(input(), "Griffith");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.geocode).mock.calls[1][1]).not.toBe(session);
  });

  it("reuses one session across the suggests of a search", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [bend] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Hor");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(1));
    await userEvent.type(input(), "se");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.geocode).mock.calls;
    expect(calls[0][1]).toBe(calls[1][1]);
  });

  it("starts a new session when the search is cleared with Escape or by deleting the text", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [bend] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Hor");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(1));
    await userEvent.keyboard("{Escape}");
    await userEvent.type(input(), "Bend");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(2));
    await userEvent.clear(input());
    await userEvent.type(input(), "Lake");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(api.geocode).mock.calls;
    expect(new Set(calls.map((c) => c[1])).size).toBe(3);
  });

  it("ignores extra clicks while retrieving and shows an error if it fails", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [bend] });
    let rejectRetrieve!: (e: Error) => void;
    vi.mocked(api.retrievePlace).mockImplementation(() => new Promise((_, reject) => { rejectRetrieve = reject; }));
    const onSelect = vi.fn();
    render(<SearchBar getProximity={() => null} onSelect={onSelect} />);
    await userEvent.type(input(), "Horseshoe");
    const button = await screen.findByRole("button", { name: /Horseshoe Bend/ });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(api.retrievePlace).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => rejectRetrieve(new Error("Place lookup failed. Please try again.")));
    expect(await screen.findByText("Place lookup failed. Please try again.")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Horseshoe Bend/ }) as HTMLButtonElement).disabled).toBe(false); // can retry
  });

  it("renews the session after picking a fallback row too", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await userEvent.click(await screen.findByRole("button", { name: "Fresno, California" }));
    await userEvent.type(input(), "Fres");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.geocode).mock.calls[1][1]).not.toBe(vi.mocked(api.geocode).mock.calls[0][1]);
  });

  it("still works where crypto.randomUUID is unavailable (insecure context)", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
      render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
      await userEvent.type(input(), "Fres");
      await screen.findByRole("button", { name: "Fresno, California" });
      expect(vi.mocked(api.geocode).mock.calls[0][1]).toMatch(UUID);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("starts only one retrieve for two clicks in the same tick", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [bend] });
    vi.mocked(api.retrievePlace).mockImplementation(() => new Promise(() => {}));
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Horseshoe");
    const button = await screen.findByRole("button", { name: /Horseshoe Bend/ });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.retrievePlace).toHaveBeenCalledTimes(1);
  });

  it("searches again when identical text is retyped right after a clear", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await userEvent.click(await screen.findByRole("button", { name: "Fresno, California" }));
    await userEvent.type(input(), "Fres"); // well inside the 250ms debounce window
    expect(await screen.findByRole("button", { name: "Fresno, California" })).toBeTruthy();
    expect(api.geocode).toHaveBeenCalledTimes(2);
  });

  it("does not search for fewer than 2 characters", async () => {
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "F");
    await new Promise((r) => setTimeout(r, 400));
    expect(api.geocode).not.toHaveBeenCalled();
  });

  it("ignores a stale response that arrives after a newer search", async () => {
    let resolveFirst!: (v: { suggestions: SearchSuggestion[] }) => void;
    vi.mocked(api.geocode)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fr");
    await vi.waitFor(() => expect(api.geocode).toHaveBeenCalledTimes(1));
    await userEvent.type(input(), "e");
    expect(await screen.findByRole("button", { name: "Fresno, California" })).toBeTruthy();
    await act(async () => resolveFirst({ suggestions: [{ name: "Frankfurt", lat: 50, lng: 8 }] }));
    expect(screen.queryByRole("button", { name: "Frankfurt" })).toBeNull();
  });

  it("drops a retrieve that finishes after the user typed something else", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [bend] });
    let resolveRetrieve!: (v: { place: { name: string; lat: number; lng: number } }) => void;
    vi.mocked(api.retrievePlace).mockImplementation(() => new Promise((resolve) => { resolveRetrieve = resolve; }));
    const onSelect = vi.fn();
    render(<SearchBar getProximity={() => null} onSelect={onSelect} />);
    await userEvent.type(input(), "Horseshoe");
    await userEvent.click(await screen.findByRole("button", { name: /Horseshoe Bend/ }));
    await userEvent.type(input(), "x");
    await act(async () => resolveRetrieve({ place: { name: "Horseshoe Bend", lat: 1, lng: 2 } }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows no-match and error messages", async () => {
    vi.mocked(api.geocode).mockResolvedValueOnce({ suggestions: [] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "zzzz");
    expect(await screen.findByText("No matches found")).toBeTruthy();
    vi.mocked(api.geocode).mockRejectedValueOnce(new Error("Place search failed. Please try again."));
    await userEvent.type(input(), "y");
    expect(await screen.findByText("Place search failed. Please try again.")).toBeTruthy();
  });

  it("clears on Escape", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await screen.findByRole("button", { name: "Fresno, California" });
    await userEvent.keyboard("{Escape}");
    expect((input() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Fresno, California" })).toBeNull();
  });
});
