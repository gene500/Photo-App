// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TripPlan } from "./TripPlan";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const optimize = { onOptimize: () => {}, onUndo: null, busy: false, undoing: false, disabled: false, status: "" };

describe("TripPlan", () => {
  it("shows an optimize result inline for everyone, in the one live region, and hides the empty region visually", () => {
    const { rerender } = render(<TripPlan startTime={null} optimize={optimize} routeStatus="" swapNote={null} list={null} />);
    expect(screen.getByTestId("optimize-status").className).toBe("sr-only");
    rerender(<TripPlan startTime={null} optimize={{ ...optimize, status: "Can't fit 2 stops in their light: C, B." }} routeStatus="" swapNote={null} list={null} />);
    const note = screen.getByTestId("optimize-status");
    expect(note.className).not.toContain("sr-only");
    expect(note.className).toContain("bg-accent-soft");
    expect(note.getAttribute("role")).toBe("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(note.textContent).toBe("Can't fit 2 stops in their light: C, B.");
  });

  it("puts a gear link to the optimize settings beside the Optimize route button", () => {
    render(<TripPlan startTime={null} optimize={optimize} routeStatus="199 mi · 7 h 0 min" swapNote={null} list={null} />);
    expect(screen.getByRole("link", { name: "Optimize settings" }).getAttribute("href")).toBe("/settings#optimize");
  });

  it("shows the route totals on the same row as the Optimize route button", () => {
    render(<TripPlan startTime={null} optimize={optimize} routeStatus="199 mi · 7 h 0 min" swapNote={null} list={null} />);
    const button = screen.getByRole("button", { name: "Optimize route" });
    expect(button.parentElement).toBe(screen.getByTestId("route-status").parentElement);
  });

  it("keeps keyboard focus on Optimize route while it runs", async () => {
    const { rerender } = render(<TripPlan startTime={null} optimize={optimize} routeStatus="" swapNote={null} list={null} />);
    screen.getByRole("button", { name: "Optimize route" }).focus();
    rerender(<TripPlan startTime={null} optimize={{ ...optimize, busy: true, disabled: true }} routeStatus="" swapNote={null} list={null} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Optimizing…" }));
  });
});
