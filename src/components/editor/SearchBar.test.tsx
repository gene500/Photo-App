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
    await userEvent.click(await screen.findByRole("option", { name: "Fresno, California" }));
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
    await userEvent.click(screen.getByRole("option", { name: /Horseshoe Bend/ }));
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
    await screen.findByRole("option");
    await userEvent.keyboard("{Escape}{Escape}");
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
    const button = await screen.findByRole("option", { name: /Horseshoe Bend/ });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(api.retrievePlace).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).getAttribute("aria-disabled")).toBe("true");
    await act(async () => rejectRetrieve(new Error("Place lookup failed. Please try again.")));
    expect(await screen.findByText("Place lookup failed. Please try again.")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    expect((screen.getByRole("option", { name: /Horseshoe Bend/ }) as HTMLButtonElement).getAttribute("aria-disabled")).toBeNull(); // can retry
  });

  it("renews the session after picking a fallback row too", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await userEvent.click(await screen.findByRole("option", { name: "Fresno, California" }));
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
      await screen.findByRole("option", { name: "Fresno, California" });
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
    const button = await screen.findByRole("option", { name: /Horseshoe Bend/ });
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
    await userEvent.click(await screen.findByRole("option", { name: "Fresno, California" }));
    await userEvent.type(input(), "Fres"); // well inside the 250ms debounce window
    expect(await screen.findByRole("option", { name: "Fresno, California" })).toBeTruthy();
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
    expect(await screen.findByRole("option", { name: "Fresno, California" })).toBeTruthy();
    await act(async () => resolveFirst({ suggestions: [{ name: "Frankfurt", lat: 50, lng: 8 }] }));
    expect(screen.queryByRole("option", { name: "Frankfurt" })).toBeNull();
  });

  it("drops a retrieve that finishes after the user typed something else", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [bend] });
    let resolveRetrieve!: (v: { place: { name: string; lat: number; lng: number } }) => void;
    vi.mocked(api.retrievePlace).mockImplementation(() => new Promise((resolve) => { resolveRetrieve = resolve; }));
    const onSelect = vi.fn();
    render(<SearchBar getProximity={() => null} onSelect={onSelect} />);
    await userEvent.type(input(), "Horseshoe");
    await userEvent.click(await screen.findByRole("option", { name: /Horseshoe Bend/ }));
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

  it("first Escape closes the list and keeps the text; typing reopens it", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await screen.findByRole("option", { name: "Fresno, California" });
    await userEvent.keyboard("{Escape}");
    expect((input() as HTMLInputElement).value).toBe("Fres");
    expect(screen.queryByRole("option")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    await userEvent.type(input(), "n");
    expect(await screen.findByRole("option", { name: "Fresno, California" })).toBeTruthy();
  });

  it("says the session expired when the search is refused with 401", async () => {
    vi.mocked(api.geocode).mockRejectedValue(new Error("Your session has expired. Log in again to keep working."));
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    expect(await screen.findByText("Your session has expired. Log in again to keep working.")).toBeTruthy();
  });

  it("clears on a second Escape", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await screen.findByRole("option", { name: "Fresno, California" });
    await userEvent.keyboard("{Escape}{Escape}");
    expect((input() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("option", { name: "Fresno, California" })).toBeNull();
  });

  it("puts focus back in the search box after a result is picked (the result button unmounts)", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await userEvent.click(await screen.findByRole("option", { name: "Fresno, California" }));
    expect(document.activeElement).toBe(input());
  });

  it("treats a geocode answer without suggestions as no matches instead of going silent", async () => {
    vi.mocked(api.geocode).mockResolvedValue({} as never);
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    expect(await screen.findByText("No matches found")).toBeTruthy();
  });

  it("exposes a listbox of options the arrow keys walk through, and Enter picks", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno, { name: "Frankfurt", lat: 50.1, lng: 8.7 }] });
    const onSelect = vi.fn();
    render(<SearchBar getProximity={() => null} onSelect={onSelect} />);
    expect(input().getAttribute("aria-controls")).toBeNull();
    await userEvent.type(input(), "Fr");
    const list = await screen.findByRole("listbox");
    expect(input().getAttribute("aria-controls")).toBe(list.id);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    await userEvent.keyboard("{ArrowDown}");
    const first = screen.getAllByRole("option")[0]!;
    expect(input().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowDown}");
    expect(input().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]!.id);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(input().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]!.id); // wraps
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith({ name: "Frankfurt", lat: 50.1, lng: 8.7 });
  });

  it("announces no-match and errors through a status region that is always there", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    await userEvent.type(input(), "zzz");
    await screen.findByText("No matches found");
    expect(screen.getByRole("status").textContent).toBe("No matches found");
  });

  it("limits the text to 200 characters", () => {
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    expect(input().getAttribute("maxlength")).toBe("200");
  });

  it("ArrowDown brings the list back after Escape closed it", async () => {
    vi.mocked(api.geocode).mockResolvedValue({ suggestions: [fresno] });
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    await userEvent.type(input(), "Fres");
    await screen.findByRole("option", { name: "Fresno, California" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input().getAttribute("aria-activedescendant")).toBe("place-option-0");
  });
});
