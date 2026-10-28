// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stop, Suggestion } from "@/lib/types";
import { FakeMapPanel } from "./FakeMapPanel";

const loadPlacePhoto = vi.fn();
vi.mock("@/lib/place-photo-cache", () => ({ loadPlacePhoto: (...a: unknown[]) => loadPlacePhoto(...a) }));

const stop: Stop = { id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [] };
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

  it("stop markers use the shared distinctive class and stand apart from suggestion dots", () => {
    render(<FakeMapPanel {...base} stops={[stop]} suggestions={[suggestion]} />);
    const stopClass = screen.getByRole("button", { name: "Stop 1: Pin 1" }).className;
    expect(stopClass).toContain("h-8 w-8");
    expect(stopClass).toContain("border-[3px]");
    const dot = screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" }).className;
    expect(dot).toContain("h-3.5");
    expect(dot).toContain("opacity-70");
  });

  it("keeps stop markers above the suggestion dots that follow them, so a dot never covers a stop or takes its click", () => {
    render(<FakeMapPanel {...base} stops={[stop]} suggestions={[{ ...suggestion, lat: stop.lat, lng: stop.lng }]} />);
    const stopBtn = screen.getByRole("button", { name: "Stop 1: Pin 1" });
    const dot = screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" });
    expect(stopBtn.className).toContain("z-[1]");
    expect(dot.className).not.toMatch(/\bz-/);
    expect(stopBtn.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // dot is later in the DOM, so the z-index is what keeps the stop on top
  });

  it("tags markers for the shared dark-mode focus ring and uses the route token colour with a casing", () => {
    render(<FakeMapPanel {...base} stops={[stop]} suggestions={[suggestion]} routeGeometry={[[-119, 37], [-118.5, 37.2]]} />);
    expect(screen.getByRole("button", { name: "Stop 1: Pin 1" }).className).toContain("map-marker");
    expect(screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" }).className).toContain("map-marker");
    expect(screen.getByTestId("route-line").getAttribute("stroke")).toBe("#a8834b");
    expect(screen.getByTestId("route-casing")).toBeTruthy();
  });

  it("rings the selected stop in the route colour", () => {
    render(<FakeMapPanel {...base} stops={[stop]} selectedId="s1" />);
    expect(screen.getByRole("button", { name: "Stop 1: Pin 1" }).className).toContain("ring-route");
  });

  it("tags the route line for e2e, and draws none without a route", () => {
    const { rerender } = render(<FakeMapPanel {...base} stops={[stop]} />);
    expect(screen.queryByTestId("route-line")).toBeNull();
    rerender(<FakeMapPanel {...base} stops={[stop]} routeGeometry={[[-119, 37], [-118.5, 37.2]]} />);
    expect(screen.getByTestId("route-line")).toBeTruthy();
  });

  it("enlarges the highlighted suggestion marker", () => {
    render(<FakeMapPanel {...base} suggestions={[suggestion]} highlightedSuggestionId="node/1" />);
    expect(screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" }).className).toContain("h-5 w-5");
  });

  it("shows the pending pin and clickable suggestion markers", () => {
    const onSuggestionClick = vi.fn();
    const onMapClick = vi.fn();
    render(<FakeMapPanel {...base} pending={{ lat: 37.5, lng: -119 }} suggestions={[suggestion]} onSuggestionClick={onSuggestionClick} onMapClick={onMapClick} />);
    expect(screen.getByLabelText("Selected place on the map")).toBeTruthy();
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

describe("FakeMapPanel sky lines", () => {
  const sky = { lat: 37, lng: -119.5, sunrise: 60, sunset: 300 };

  it("draws a sunrise and a sunset line with their bearings", () => {
    render(<FakeMapPanel {...base} sky={sky} />);
    expect(screen.getByTestId("sky-line-sunrise").getAttribute("data-bearing")).toBe("60");
    expect(screen.getByTestId("sky-line-sunset").getAttribute("data-bearing")).toBe("300");
  });

  it("puts an arrowhead on each line whose tip points at the stop", () => {
    render(<FakeMapPanel {...base} sky={sky} />);
    for (const name of ["sunrise", "sunset"]) {
      const line = (screen.getByTestId(`sky-line-${name}`).getAttribute("points") ?? "").split(" ")[0]!.split(",").map(Number);
      const [tip, left, right] = (screen.getByTestId(`sky-arrow-${name}`).getAttribute("points") ?? "").split(" ").map((p) => p.split(",").map(Number));
      const dist = (p: number[]) => Math.hypot(p[0]! - line[0]!, p[1]! - line[1]!);
      expect(dist(tip!)).toBeLessThan(dist(left!));
      expect(dist(tip!)).toBeLessThan(dist(right!));
    }
  });

  it("draws only the line whose bearing is known", () => {
    render(<FakeMapPanel {...base} sky={{ ...sky, sunrise: null }} />);
    expect(screen.queryByTestId("sky-line-sunrise")).toBeNull();
    expect(screen.getByTestId("sky-line-sunset")).toBeTruthy();
  });

  it("draws nothing without sky", () => {
    const { rerender } = render(<FakeMapPanel {...base} sky={null} />);
    expect(screen.queryByTestId("sky-line-sunrise")).toBeNull();
    expect(screen.queryByTestId("sky-line-sunset")).toBeNull();
    rerender(<FakeMapPanel {...base} />);
    expect(screen.queryByTestId("sky-line-sunset")).toBeNull();
  });

  it("marks the selected stop marker with aria-pressed and the pending pin as an image", () => {
    const stops = [{ ...stop, id: "s1", name: "A" }, { ...stop, id: "s2", name: "B", order: 1, lat: 37.1, lng: -119.1 }];
    render(<FakeMapPanel {...base} stops={stops} selectedId="s2" pending={{ lat: 37.5, lng: -119 }} />);
    expect(screen.getByRole("button", { name: "Stop 1: A" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Stop 2: B" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Selected place on the map" })).toBeTruthy();
  });

  it("Escape dismisses the suggestion popup shown on keyboard focus", () => {
    loadPlacePhoto.mockResolvedValue(null);
    render(<FakeMapPanel {...base} suggestions={[suggestion]} />);
    const dot = screen.getByRole("button", { name: "Suggestion: Fake Viewpoint" });
    fireEvent.focus(dot);
    expect(screen.queryByText("Fake Viewpoint")).toBeTruthy();
    fireEvent.keyDown(dot, { key: "Escape" });
    expect(screen.queryByText("Fake Viewpoint")).toBeNull();
  });

  it("fans out stops at identical coordinates so each is separately clickable", () => {
    const onStopClick = vi.fn();
    const a = { ...stop, id: "a", name: "A" };
    const b = { ...stop, id: "b", name: "B" };
    render(<FakeMapPanel {...base} onStopClick={onStopClick} stops={[a, b]} />);
    const m1 = screen.getByRole("button", { name: "Stop 1: A" });
    const m2 = screen.getByRole("button", { name: "Stop 2: B" });
    expect(m1.style.left + m1.style.top).not.toBe(m2.style.left + m2.style.top);
    fireEvent.click(m1);
    fireEvent.click(m2);
    expect(onStopClick.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("does not move stops that are far apart", () => {
    render(<FakeMapPanel {...base} stops={[{ ...stop, id: "a", name: "A" }, { ...stop, id: "b", name: "B", lat: 38, lng: -118 }]} />);
    expect(parseFloat(screen.getByRole("button", { name: "Stop 1: A" }).style.left)).toBeCloseTo(66.667, 2);
    expect(screen.getByRole("button", { name: "Stop 2: B" }).style.left).toBe("100%");
  });

  describe("route flow after Optimize", () => {
    const route: [number, number][] = [[-120, 36.5], [-119, 37], [-118.5, 37.5]];
    const two: Stop[] = [stop, { ...stop, id: "s2", lat: 37.5, lng: -118.5 }];
    const flowProps = { ...base, stops: two, routeGeometry: route };
    const mq = (reduce: boolean) =>
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduced-motion"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never);

    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it("shows nothing for the run id it mounts with, then runs and finishes for a new one", () => {
      vi.useFakeTimers();
      mq(false);
      const { rerender } = render(<FakeMapPanel {...flowProps} routeFlowId={3} />);
      expect(screen.getByTestId("map").hasAttribute("data-route-flow")).toBe(false);
      rerender(<FakeMapPanel {...flowProps} routeFlowId={4} />);
      expect(screen.getByTestId("map").getAttribute("data-route-flow")).toBe("running");
      expect(screen.getByTestId("route-flow")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.getByTestId("map").getAttribute("data-route-flow")).toBe("done");
      expect(screen.queryByTestId("route-flow")).toBeNull();
      rerender(<FakeMapPanel {...flowProps} routeFlowId={5} />);
      expect(screen.getByTestId("map").getAttribute("data-route-flow")).toBe("running");
    });

    it("waits for the route, and is cancelled by an edit to the stops", () => {
      vi.useFakeTimers();
      mq(false);
      const { rerender } = render(<FakeMapPanel {...base} stops={two} routeGeometry={null} routeFlowId={0} />);
      rerender(<FakeMapPanel {...base} stops={two} routeGeometry={null} routeFlowId={1} />);
      expect(screen.getByTestId("map").hasAttribute("data-route-flow")).toBe(false);
      rerender(<FakeMapPanel {...flowProps} routeFlowId={1} />);
      expect(screen.getByTestId("map").getAttribute("data-route-flow")).toBe("running");
      rerender(<FakeMapPanel {...flowProps} stops={[two[1], two[0]]} routeFlowId={1} />);
      expect(screen.getByTestId("map").getAttribute("data-route-flow")).toBe("done");
    });

    it("draws no sweep with reduced motion", () => {
      mq(true);
      const { rerender } = render(<FakeMapPanel {...flowProps} routeFlowId={0} />);
      rerender(<FakeMapPanel {...flowProps} routeFlowId={1} />);
      expect(screen.getByTestId("map").getAttribute("data-route-flow")).toBe("done");
      expect(screen.queryByTestId("route-flow")).toBeNull();
    });
  });
});

describe("FakeMapPanel zoom to fit", () => {
  it("is absent with no stops", () => {
    render(<FakeMapPanel {...base} />);
    expect(screen.queryByRole("button", { name: "Zoom to fit all stops" })).toBeNull();
  });

  it("counts presses in data-fit-count without dropping a pin", () => {
    const onMapClick = vi.fn();
    render(<FakeMapPanel {...base} stops={[stop]} onMapClick={onMapClick} />);
    const btn = screen.getByRole("button", { name: "Zoom to fit all stops" });
    expect(btn.getAttribute("type")).toBe("button");
    expect(screen.getByTestId("map").getAttribute("data-fit-count")).toBe("0");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByTestId("map").getAttribute("data-fit-count")).toBe("2");
    expect(onMapClick).not.toHaveBeenCalled();
  });

  it("draws a dotted hike polyline per hike, with the stop id and point count as data attributes", () => {
    const hikes = [{ id: "s1", geometry: [[-119.52, 36.99], [-119.51, 36.995], [-119.5, 37]] as [number, number][] }];
    const { rerender } = render(<FakeMapPanel {...base} stops={[stop]} hikes={hikes} />);
    const line = screen.getByTestId("hike-line");
    expect(line.getAttribute("data-stop-id")).toBe("s1");
    expect(line.getAttribute("data-points")).toBe("3");
    expect(line.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(line.getAttribute("points")?.split(" ")).toHaveLength(3);
    // It is not the route.
    expect(screen.queryByTestId("route-line")).toBeNull();
    rerender(<FakeMapPanel {...base} stops={[stop]} hikes={[]} />);
    expect(screen.queryByTestId("hike-line")).toBeNull();
  });
});
