// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stop, Suggestion } from "@/lib/types";
import { FakeMapPanel } from "./FakeMapPanel";

const loadPlacePhoto = vi.fn();
vi.mock("@/lib/place-photo-cache", () => ({ loadPlacePhoto: (...a: unknown[]) => loadPlacePhoto(...a) }));

const stop: Stop = { id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false };
const suggestion: Suggestion = { osmId: "node/1", name: "Fake Viewpoint", lat: 37.2, lng: -119.2, kind: "viewpoint" };
const base = { stops: [] as Stop[], routeGeometry: null, onMapClick: vi.fn(), onStopClick: vi.fn() };

describe("FakeMapPanel", () => {
  beforeEach(() => loadPlacePhoto.mockResolvedValue(null));
  afterEach(() => {
    vi.restoreAllMocks();
    loadPlacePhoto.mockReset();
  });

  it("converts a click position into lat/lng inside the fixed viewport", () => {
    const onMapClick = vi.fn();
    render(<FakeMapPanel stops={[]} routeGeometry={null} onMapClick={onMapClick} onStopClick={vi.fn()} />);
    const map = screen.getByTestId("map");
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(map, { clientX: 100, clientY: 50 });
    const { lat, lng } = onMapClick.mock.calls[0][0];
    expect(lat).toBeCloseTo(37);
    expect(lng).toBeCloseTo(-119.5);
  });

  it("reports its centre on mount so searches can be biased", () => {
    const onCenterChange = vi.fn();
    render(<FakeMapPanel stops={[]} routeGeometry={null} onMapClick={vi.fn()} onStopClick={vi.fn()} onCenterChange={onCenterChange} />);
    expect(onCenterChange).toHaveBeenCalledWith({ lat: 37, lng: -119.5 });
  });

  it("renders numbered stop markers; clicking one selects it without dropping a pin", () => {
    const onMapClick = vi.fn();
    const onStopClick = vi.fn();
    render(<FakeMapPanel stops={[stop]} routeGeometry={[[-120, 36], [-118, 38]]} onMapClick={onMapClick} onStopClick={onStopClick} />);
    const marker = screen.getByRole("button", { name: "Stop 1: Pin 1" });
    expect(marker.textContent).toBe("1");
    fireEvent.click(marker);
    expect(onStopClick).toHaveBeenCalledWith("s1");
    expect(onMapClick).not.toHaveBeenCalled();
  });

  it("positions markers against the fixed viewport regardless of the stops", () => {
    render(<FakeMapPanel {...base} stops={[{ ...stop, lat: 38, lng: -118 }]} />);
    expect(screen.getByRole("button", { name: "Stop 1: Pin 1" }).style.left).toBe("100%");
  });

  it("rings the selected stop marker", () => {
    render(<FakeMapPanel {...base} stops={[stop]} selectedId="s1" />);
    expect(screen.getByRole("button", { name: "Stop 1: Pin 1" }).className).toContain("ring-2");
  });

  it("enlarges the highlighted suggestion marker", () => {
    render(<FakeMapPanel {...base} suggestions={[suggestion]} highlightedSuggestionId="node/1" />);
    expect(screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" }).className).toContain("h-5 w-5");
  });

  it("shows the pending pin and clickable suggestion markers", () => {
    const onSuggestionClick = vi.fn();
    const onMapClick = vi.fn();
    render(<FakeMapPanel {...base} pending={{ lat: 37.5, lng: -119 }} suggestions={[suggestion]} onSuggestionClick={onSuggestionClick} onMapClick={onMapClick} />);
    expect(screen.getByLabelText("Selected place")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" }));
    expect(onSuggestionClick).toHaveBeenCalledWith("node/1");
    expect(onMapClick).not.toHaveBeenCalled();
  });

  describe("suggestion photo popup", () => {
    const photo = { url: "https://upload.wikimedia.org/a.jpg", title: "Fake Viewpoint", pageUrl: "https://en.wikipedia.org/wiki/X", credit: "Photo: Jane Doe via Flickr (CC BY 2.0)" };
    const dot = () => screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" });

    it("shows the name and photo on hover and removes the popup on leave", async () => {
      loadPlacePhoto.mockResolvedValue(photo);
      render(<FakeMapPanel {...base} suggestions={[suggestion]} />);
      expect(screen.queryByTestId("suggestion-popup")).toBeNull();
      fireEvent.pointerEnter(dot());
      expect(screen.getByTestId("suggestion-popup-name").textContent).toBe("Fake Viewpoint");
      await waitFor(() => expect(screen.getByTestId("suggestion-popup").querySelector("img")).not.toBeNull());
      expect(loadPlacePhoto).toHaveBeenCalledWith({ key: "node/1", name: "Fake Viewpoint", lat: 37.2, lng: -119.2 });
      fireEvent.pointerLeave(dot());
      expect(screen.queryByTestId("suggestion-popup")).toBeNull();
    });

    it("ignores touch pointers (iOS would swallow the tap's click) but still hovers with a mouse or pen", () => {
      render(<FakeMapPanel {...base} suggestions={[suggestion]} />);
      fireEvent.pointerEnter(dot(), { pointerType: "touch" });
      expect(screen.queryByTestId("suggestion-popup")).toBeNull();
      fireEvent.pointerEnter(dot(), { pointerType: "mouse" });
      expect(screen.getByTestId("suggestion-popup")).toBeTruthy();
    });

    it("does not hover-open on devices that cannot hover", () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(hover: none)" }));
      try {
        render(<FakeMapPanel {...base} suggestions={[suggestion]} />);
        fireEvent.pointerEnter(dot(), { pointerType: "mouse" });
        expect(screen.queryByTestId("suggestion-popup")).toBeNull();
        fireEvent.focus(dot()); // keyboard still works
        expect(screen.getByTestId("suggestion-popup")).toBeTruthy();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("shows the photo credit and the photo count caption", async () => {
      loadPlacePhoto.mockResolvedValue(photo);
      render(<FakeMapPanel {...base} suggestions={[{ ...suggestion, popularity: 1234 }]} />);
      fireEvent.pointerEnter(dot());
      await waitFor(() => expect(screen.getByTestId("suggestion-popup").textContent).toContain("Photo: Jane Doe via Flickr (CC BY 2.0)"));
      expect(screen.getByTestId("suggestion-popup-popularity").textContent).toBe("≈1.2k photos nearby");
    });

    it("opens on keyboard focus, closes on blur and when the dot is clicked", () => {
      loadPlacePhoto.mockResolvedValue(null);
      render(<FakeMapPanel {...base} suggestions={[suggestion]} />);
      fireEvent.focus(dot());
      expect(screen.getByTestId("suggestion-popup")).toBeTruthy();
      fireEvent.blur(dot());
      expect(screen.queryByTestId("suggestion-popup")).toBeNull();
      fireEvent.pointerEnter(dot());
      fireEvent.click(dot());
      expect(screen.queryByTestId("suggestion-popup")).toBeNull();
    });

    it("opens for the suggestion highlighted from the panel", () => {
      loadPlacePhoto.mockResolvedValue(null);
      render(<FakeMapPanel {...base} suggestions={[suggestion]} highlightedSuggestionId="node/1" />);
      expect(screen.getByTestId("suggestion-popup-name").textContent).toBe("Fake Viewpoint");
    });
  });
});
