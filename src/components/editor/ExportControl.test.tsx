// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportControl } from "./ExportControl";

const stop = (i: number) => ({ name: `S${i}`, lat: 40 + i, lng: -120, notes: null });

describe("ExportControl", () => {
  let clicked: { download: string; href: string }[];
  beforeEach(() => {
    clicked = [];
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("is disabled with fewer than 2 stops", () => {
    render(<ExportControl tripName="T" stops={[stop(0)]} route={null} />);
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers GPX and both map links with 2 stops", async () => {
    render(<ExportControl tripName="Big Sur / 2026" stops={[stop(0), stop(1)]} route={[[-120, 40], [-120, 41]]} />);
    expect(screen.queryByRole("group", { name: "Export trip" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    const g = screen.getByRole("link", { name: "Open in Google Maps" });
    expect(g.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/);
    expect(g.getAttribute("target")).toBe("_blank");
    expect(g.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: "Open in Apple Maps" }).getAttribute("href")).toMatch(/^https:\/\/maps\.apple\.com\/\?saddr=/);
    await userEvent.click(screen.getByRole("button", { name: "Download GPX" }));
    expect(clicked).toEqual([{ download: "Big-Sur-2026.gpx", href: "blob:fake" }]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // revoked a moment later, not synchronously
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(screen.queryByRole("group", { name: "Export trip" })).toBeNull();
  });

  it("shows one Google link per part for long trips", async () => {
    render(<ExportControl tripName="T" stops={Array.from({ length: 12 }, (_, i) => stop(i))} route={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("link", { name: "Open in Google Maps (Part 1/2)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Google Maps (Part 2/2)" })).toBeTruthy();
  });

  describe("popover behaviour", () => {
    const two = [stop(0), stop(1)];

    it("is a plain disclosure: aria-expanded and aria-controls, no menu role or aria-haspopup", async () => {
      render(<ExportControl tripName="T" stops={two} route={null} />);
      const btn = screen.getByRole("button", { name: "Export" });
      expect(btn.getAttribute("aria-haspopup")).toBeNull();
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      await userEvent.click(btn);
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      expect(document.getElementById(btn.getAttribute("aria-controls")!)).toBe(screen.getByRole("group", { name: "Export trip" }));
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    });

    it("moves focus into the panel, and Escape closes it and returns focus to the trigger", async () => {
      render(<ExportControl tripName="T" stops={two} route={null} />);
      const btn = screen.getByRole("button", { name: "Export" });
      await userEvent.click(btn);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Download GPX" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("group", { name: "Export trip" })).toBeNull();
      expect(document.activeElement).toBe(btn);
    });

    it("closes on an outside press but not on a press inside", async () => {
      render(<div><p>outside</p><ExportControl tripName="T" stops={two} route={null} /></div>);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      await userEvent.click(screen.getByRole("group", { name: "Export trip" }));
      expect(screen.getByRole("group", { name: "Export trip" })).toBeTruthy();
      await userEvent.click(screen.getByText("outside"));
      expect(screen.queryByRole("group", { name: "Export trip" })).toBeNull();
    });

    it("closes when a map link is chosen", async () => {
      render(<ExportControl tripName="T" stops={two} route={null} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      const link = screen.getByRole("link", { name: "Open in Apple Maps" });
      link.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
      await userEvent.click(link);
      expect(screen.queryByRole("group", { name: "Export trip" })).toBeNull();
    });

    it("closes, and stays closed, when stops drop below 2", async () => {
      const { rerender } = render(<ExportControl tripName="T" stops={two} route={null} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      rerender(<ExportControl tripName="T" stops={[stop(0)]} route={null} />);
      expect(screen.queryByRole("group", { name: "Export trip" })).toBeNull();
      rerender(<ExportControl tripName="T" stops={two} route={null} />);
      expect(screen.queryByRole("group", { name: "Export trip" })).toBeNull();
    });
  });
});
