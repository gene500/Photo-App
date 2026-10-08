// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@/lib/types";
import { AlternativesPanel } from "./AlternativesPanel";

const loadPlacePhoto = vi.fn();
vi.mock("@/lib/place-photo-cache", () => ({ loadPlacePhoto: (...a: unknown[]) => loadPlacePhoto(...a) }));

const alt: Suggestion = { osmId: "node/1", name: "Glacier Point", lat: 37.7, lng: -119.5, kind: "viewpoint", popularity: 1234 };
const base = { status: "idle" as const, alternatives: [], error: null, onFind: () => {}, onSwap: () => {}, onDismissError: () => {} };

describe("AlternativesPanel", () => {
  it("asks to find alternatives, and shows Searching while loading", async () => {
    const onFind = vi.fn();
    const { rerender } = render(<AlternativesPanel {...base} onFind={onFind} />);
    await userEvent.click(screen.getByRole("button", { name: "Find alternatives" }));
    expect(onFind).toHaveBeenCalled();
    rerender(<AlternativesPanel {...base} status="loading" />);
    expect((screen.getByRole("button", { name: "Searching…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists name, kind, popularity and a thumbnail, and swaps one in", async () => {
    loadPlacePhoto.mockResolvedValue({ url: "https://img.test/a.jpg", credit: "x" });
    const onSwap = vi.fn();
    render(<AlternativesPanel {...base} status="done" alternatives={[alt]} onSwap={onSwap} />);
    expect(screen.getByTestId("alternative-name").textContent).toBe("Glacier Point");
    expect(screen.getByTestId("alternative-popularity").textContent).toContain("≈1.2k photos nearby");
    expect((await screen.findByAltText("Photo of Glacier Point") as HTMLImageElement).src).toBe("https://img.test/a.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Swap in Glacier Point" }));
    expect(onSwap).toHaveBeenCalledWith(alt);
  });

  it("shows an empty result and an error", () => {
    const { rerender } = render(<AlternativesPanel {...base} status="done" />);
    expect(screen.getByText("No other photo spots within 10 km.")).toBeTruthy();
    rerender(<AlternativesPanel {...base} status="error" error="Couldn't load suggestions. Please retry." />);
    expect(screen.getByText("Couldn't load suggestions. Please retry.")).toBeTruthy();
  });
});
