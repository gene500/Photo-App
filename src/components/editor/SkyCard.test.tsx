// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkyCard } from "./SkyCard";

const PHASES = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon", "waning gibbous", "last quarter", "waning crescent"];

describe("SkyCard", () => {
  it("shows sunrise, sunset and the moon, with a dial naming both bearings", () => {
    render(<SkyCard lat={37.7156} lng={-119.6773} plannedDate="2026-06-21" />);
    const text = screen.getByTestId("sky-card").textContent ?? "";
    expect(text).toContain("Sunrise");
    expect(text).toMatch(/ENE|NE/);
    expect(text).toMatch(/\b(5[89]|6[0-2])°/);
    expect(text).toContain("Sunset");
    expect(PHASES.some((p) => text.toLowerCase().includes(p))).toBe(true);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/Sunrise from \w+ \d+°, sunset toward \w+ \d+°/);
  });

  it("explains polar day with no sunrise or sunset time rows and no dial markers", () => {
    render(<SkyCard lat={78} lng={15} plannedDate="2026-06-21" />);
    const card = screen.getByTestId("sky-card");
    expect(card.textContent).toContain("Sun does not set on this date");
    expect(card.textContent).not.toMatch(/Sunrise \d/);
    expect(card.querySelectorAll("[data-marker]").length).toBe(0);
  });

  it("explains polar night", () => {
    render(<SkyCard lat={78} lng={15} plannedDate="2026-12-21" />);
    expect(screen.getByTestId("sky-card").textContent).toContain("Sun does not rise on this date");
  });

  it.each([
    [NaN, 0, "2026-06-21"],
    [0, NaN, "2026-06-21"],
    [37, -119, "June 21"],
    [37, -119, ""],
  ])("renders nothing for invalid input %s %s %s", (lat, lng, plannedDate) => {
    expect(() => render(<SkyCard lat={lat} lng={lng} plannedDate={plannedDate} />)).not.toThrow();
    expect(screen.queryByTestId("sky-card")).toBeNull();
  });
});
