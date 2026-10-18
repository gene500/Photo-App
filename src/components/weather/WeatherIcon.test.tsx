// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WeatherLabel } from "@/lib/weather";
import { WeatherIcon, WeatherText } from "./WeatherIcon";

const SKIES: WeatherLabel[] = ["Clear", "Partly cloudy", "Mostly cloudy", "Overcast", "Rain likely"];

describe("WeatherIcon", () => {
  it("draws one stroked currentColor SVG per sky kind", () => {
    const html = SKIES.map((sky) => {
      const { container, unmount } = render(<WeatherIcon sky={sky} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("data-sky")).toBe(sky);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("fill")).toBe("none");
      for (const el of svg.querySelectorAll("[fill]")) expect(["none", "currentColor"]).toContain(el.getAttribute("fill"));
      const inner = svg.innerHTML;
      unmount();
      return inner;
    });
    expect(new Set(html).size).toBe(5);
  });

  it("labels the line in words with the temperature", () => {
    render(<WeatherText line={{ text: "18°C", sky: "Clear", label: "clear, 0% rain", quality: "good" }} />);
    expect(screen.getByRole("img", { name: "clear, 0% rain, 18°C" })).toBeTruthy();
  });

  it("contains no emoji", () => {
    for (const sky of SKIES) {
      const { container, unmount } = render(<WeatherText line={{ text: "Typical 18°C", sky, label: "x", quality: null }} />);
      expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
      unmount();
    }
  });

  it("shows plain text with no icon when there is no sky", () => {
    const { container } = render(<WeatherText line={{ text: "Forecast not available yet", quality: null }} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("img", { name: "Forecast not available yet" })).toBeTruthy();
  });
});
