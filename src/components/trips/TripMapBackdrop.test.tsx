// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TripMapBackdrop } from "./TripMapBackdrop";

describe("TripMapBackdrop", () => {
  it("renders a decorative, non-interactive map with numbered pins", () => {
    const { container } = render(<TripMapBackdrop />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).toContain("pointer-events-none");
    const pins = container.querySelectorAll("circle");
    expect(pins.length).toBeGreaterThanOrEqual(10);
    expect(pins.length).toBeLessThanOrEqual(14);
    const labels = Array.from(container.querySelectorAll("text"))
      .map((t) => t.textContent)
      .filter((t) => /^\d+$/.test(t ?? ""));
    expect(labels).toEqual(Array.from({ length: pins.length }, (_, i) => String(i + 1)));
  });

  it("draws one connected route and a busier, zoomed-out map", () => {
    const { container } = render(<TripMapBackdrop />);
    const route = container.querySelector('[data-testid="trip-map-route"]');
    expect(route).not.toBeNull();
    // one subpath only: a single "M" means the route is one connected path
    expect((route?.getAttribute("d") ?? "").match(/M/g)).toHaveLength(1);
    expect(container.querySelectorAll('[data-map-layer="land"] path').length).toBeGreaterThanOrEqual(7);
    expect(container.querySelectorAll('[data-map-layer="roads"] path').length).toBeGreaterThanOrEqual(8);
    expect(container.querySelector("animate, animateTransform, style")).toBeNull();
  });
});
