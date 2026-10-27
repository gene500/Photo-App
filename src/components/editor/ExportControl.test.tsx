// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createItineraryPdf, loadWeatherLines, saveBlob } from "@/lib/itinerary-download";
import { ExportControl } from "./ExportControl";

vi.mock("@/lib/itinerary-download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/itinerary-download")>();
  // saveBlob is a spy; the GPX test re-installs the real implementation.
  return {
    createItineraryPdf: vi.fn(),
    loadWeatherLines: vi.fn(),
    saveBlob: vi.fn(actual.saveBlob),
    mapTokenFromEnv: vi.fn(() => null),
  };
});

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

  it("moves the menu out of the clipped sheet on short (landscape) screens", async () => {
    render(<ExportControl tripName="T" stops={[stop(0), stop(1)]} route={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    const menu = screen.getByRole("group", { name: "Export trip" });
    expect(menu.className).toContain("[@media(max-height:30rem)]:fixed");
    expect(menu.className).toContain("[@media(max-height:30rem)]:overflow-y-auto");
  });

  describe("Download PDF", () => {
    const two = [stop(0), stop(1)];
    const pdf = {
      departAt: null,
      totalDistanceM: 1000,
      totalDurationS: 600,
      stops: two.map((s) => ({ ...s, lightPref: "any" as const, arrival: null })),
    };
    beforeEach(() => {
      vi.mocked(createItineraryPdf).mockReset();
      vi.mocked(saveBlob).mockReset();
      vi.mocked(loadWeatherLines).mockReset().mockResolvedValue([null, null]);
    });

    it("is not offered without the pdf prop", async () => {
      render(<ExportControl tripName="T" stops={two} route={null} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    });

    it("builds and saves the PDF", async () => {
      const blob = new Blob(["x"]);
      vi.mocked(createItineraryPdf).mockResolvedValue(blob);
      render(<ExportControl tripName="Big Sur / 2026" stops={two} route={null} pdf={pdf} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
      expect(createItineraryPdf).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createItineraryPdf).mock.calls[0][0].input.stops).toHaveLength(2);
      expect(saveBlob).not.toHaveBeenCalled(); // not until the fresh tap on the dialog's Download
      expect(screen.queryByRole("group", { name: "Export trip" })).toBeNull();
      await userEvent.click(await screen.findByRole("button", { name: "Download" }));
      expect(saveBlob).toHaveBeenCalledWith(blob, "Big-Sur-2026-itinerary.pdf");
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Export" }));
    });

    it("adds a note when every arrival is missing, and none when some are known", async () => {
      vi.mocked(createItineraryPdf).mockResolvedValue(new Blob(["x"]));
      const { unmount } = render(<ExportControl tripName="T" stops={two} route={null} pdf={pdf} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
      expect(vi.mocked(createItineraryPdf).mock.calls[0][0].input.note).toBe("Arrival times are unavailable because the route has not been calculated.");
      unmount();
      const some = { ...pdf, stops: [{ ...pdf.stops[0], arrival: new Date("2026-10-16T10:00:00Z") }, pdf.stops[1]] };
      render(<ExportControl tripName="T" stops={two} route={null} pdf={some} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
      expect(vi.mocked(createItineraryPdf).mock.calls[1][0].input.note).toBeNull();
    });

    it("shows the Preparing dialog while pending, and a second Download PDF cannot start another build", async () => {
      let resolve!: (b: Blob) => void;
      vi.mocked(createItineraryPdf).mockReturnValue(new Promise<Blob>((r) => { resolve = r; }));
      render(<ExportControl tripName="T" stops={two} route={null} pdf={pdf} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
      const dialog = await screen.findByRole("alertdialog", { name: "Itinerary PDF" });
      expect(dialog.getAttribute("aria-busy")).toBe("true");
      expect(dialog.textContent).toContain("Preparing your PDF…");
      expect(createItineraryPdf).toHaveBeenCalledTimes(1);
      await act(async () => resolve(new Blob(["x"])));
      expect(saveBlob).not.toHaveBeenCalled();
      await userEvent.click(await screen.findByRole("button", { name: "Download" }));
      expect(saveBlob).toHaveBeenCalledTimes(1);
    });

    it("Escape in the dialog cancels it and later results are dropped", async () => {
      let resolve!: (b: Blob) => void;
      vi.mocked(createItineraryPdf).mockReturnValue(new Promise<Blob>((r) => { resolve = r; }));
      render(<ExportControl tripName="T" stops={two} route={null} pdf={pdf} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
      await screen.findByRole("alertdialog");
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("alertdialog")).toBeNull();
      await act(async () => resolve(new Blob(["x"])));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(saveBlob).not.toHaveBeenCalled();
    });

    it("shows the failure in the dialog, and Try again builds once more", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(createItineraryPdf).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(new Blob(["x"]));
      render(<ExportControl tripName="T" stops={two} route={null} pdf={pdf} />);
      await userEvent.click(screen.getByRole("button", { name: "Export" }));
      await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
      expect((await screen.findByRole("alertdialog")).textContent).toContain("Could not create the PDF. Try again.");
      expect(saveBlob).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      await userEvent.click(await screen.findByRole("button", { name: "Download" }));
      expect(createItineraryPdf).toHaveBeenCalledTimes(2);
      expect(saveBlob).toHaveBeenCalledTimes(1);
    });
  });

  it("has a tooltip (title) on the icon-only button, with a hint when disabled", () => {
    const two = [stop(1), stop(2)];
    const { unmount } = render(<ExportControl tripName="T" stops={two} route={null} />);
    expect(screen.getByRole("button", { name: "Export" }).getAttribute("title")).toBe("Export");
    unmount();
    render(<ExportControl tripName="T" stops={[stop(1)]} route={null} />);
    expect(screen.getByRole("button", { name: "Export" }).getAttribute("title")).toBe("Add 2 stops to export");
  });

  it("is disabled with fewer than 2 stops", () => {
    render(<ExportControl tripName="T" stops={[stop(0)]} route={null} />);
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers GPX and both map links with 2 stops", async () => {
    const actual = await vi.importActual<typeof import("@/lib/itinerary-download")>("@/lib/itinerary-download");
    vi.mocked(saveBlob).mockImplementation(actual.saveBlob);
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
