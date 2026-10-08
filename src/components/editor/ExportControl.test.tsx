// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    const g = screen.getByRole("link", { name: "Open in Google Maps" });
    expect(g.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/);
    expect(g.getAttribute("target")).toBe("_blank");
    expect(g.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: "Open in Apple Maps" }).getAttribute("href")).toMatch(/^https:\/\/maps\.apple\.com\/\?saddr=/);
    await userEvent.click(screen.getByRole("button", { name: "Download GPX" }));
    expect(clicked).toEqual([{ download: "Big-Sur-2026.gpx", href: "blob:fake" }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("shows one Google link per part for long trips", async () => {
    render(<ExportControl tripName="T" stops={Array.from({ length: 12 }, (_, i) => stop(i))} route={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("link", { name: "Open in Google Maps (Part 1/2)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Google Maps (Part 2/2)" })).toBeTruthy();
  });
});
