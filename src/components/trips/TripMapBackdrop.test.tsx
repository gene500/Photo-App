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
    expect(container.querySelectorAll("circle")).toHaveLength(6);
  });
});
