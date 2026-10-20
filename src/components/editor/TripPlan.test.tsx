// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TripPlan } from "./TripPlan";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const optimize = { onOptimize: () => {}, onUndo: null, busy: false, undoing: false, disabled: false, status: "" };

describe("TripPlan", () => {
  it("puts a gear link to the optimize settings beside the Optimize route button", () => {
    render(<TripPlan startTime={null} optimize={optimize} routeStatus="199 mi · 7 h 0 min" swapNote={null} list={null} />);
    expect(screen.getByRole("link", { name: "Optimize settings" }).getAttribute("href")).toBe("/settings#optimize");
  });

  it("shows the route totals on the same row as the Optimize route button", () => {
    render(<TripPlan startTime={null} optimize={optimize} routeStatus="199 mi · 7 h 0 min" swapNote={null} list={null} />);
    const button = screen.getByRole("button", { name: "Optimize route" });
    expect(button.parentElement).toBe(screen.getByTestId("route-status").parentElement);
  });
});
