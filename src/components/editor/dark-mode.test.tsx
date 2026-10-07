// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Stop } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({ api: { geocode: vi.fn() } }));
import { PlaceCard } from "./PlaceCard";
import { SearchBar } from "./SearchBar";
import { StopCard } from "./StopCard";
import { StopDrawer } from "./StopDrawer";
import { StopList } from "./StopList";
import { StopsPanel } from "./StopsPanel";

const stop: Stop = { id: "a", tripId: "t", order: 0, name: "A", lat: 1, lng: 2, notes: null, source: "manual", photoUrl: null, visited: false };

// The page text colour follows the OS theme (light text in dark mode), so every white
// floating surface must set its own dark text.
describe("white surfaces set their own text colour", () => {
  it("StopsPanel", () => {
    render(<StopsPanel header="h" collapsedSummary="c" summary="s" stops="x" suggestions="y" suggestionCount={0} />);
    expect(document.querySelector("aside")!.className).toContain("text-foreground");
  });
  it("SearchBar input", () => {
    render(<SearchBar getProximity={() => null} onSelect={vi.fn()} />);
    expect(screen.getByRole("combobox").className).toContain("text-foreground");
  });
  it("PlaceCard", () => {
    render(<PlaceCard name="x" resolving={false} busy={false} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Selected place" }).className).toContain("text-foreground");
  });
  it("StopCard", () => {
    render(<StopCard stop={stop} bestTime={null} arrival={null} onToggleVisited={vi.fn()} onOpenDetails={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Selected stop" }).className).toContain("text-foreground");
  });
  it("StopDrawer", () => {
    render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={vi.fn()} onPhotoChange={vi.fn()} />);
    expect(screen.getByRole("dialog").className).toContain("text-foreground");
  });
  it("StopList rows", () => {
    render(<StopList stops={[stop]} bestTimes={[null]} onReorder={vi.fn()} onToggleVisited={vi.fn()} onDelete={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByTestId("stop-row").className).toContain("text-foreground");
  });
});
