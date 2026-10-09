// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../tests/helpers/memory-storage";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { saveTripCopy } from "@/lib/offline-store";
import { buildGpx } from "@/lib/export";
import type { PublicTrip, Stop, TripWithStops } from "@/lib/types";
import { createSuggestionPopupContent } from "./editor/suggestion-popup";
import { FakeMapPanel } from "./editor/FakeMapPanel";
import { OfflineView } from "./offline/OfflineView";
import { SharedTripView } from "./share/SharedTripView";

// OpenStreetMap names are editable by anyone, so every place a name is shown must treat it as text.
const EVIL = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
const noInjectedNodes = (root: ParentNode) => {
  expect(root.querySelector("img[src='x']")).toBeNull();
  expect(root.querySelector("script")).toBeNull();
  expect(root.querySelector("[onerror]")).toBeNull();
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
};

vi.mock("@/lib/place-photo-cache", () => ({ loadPlacePhoto: vi.fn(async () => null) }));

const stop = (i: number, over: Partial<Stop> = {}): Stop => ({
  id: `s${i}`, tripId: "t1", order: i, name: EVIL, lat: 37.7, lng: -119.6, notes: EVIL, source: "manual",
  photoUrl: null, visited: false, lightPref: "any", dwellMinutes: 0, shotNotes: EVIL, shotChecklist: [{ text: EVIL, done: false }], ...over,
});

beforeEach(() => {
  installMemoryStorage();
  localStorage.setItem("rtpp.offline.owner", "u1");
});

describe("hostile place names are rendered as text", () => {
  it("map popup", async () => {
    const root = createSuggestionPopupContent({ name: EVIL, kind: "viewpoint" }, async () => ({ url: "https://upload.wikimedia.org/a.jpg", title: EVIL, pageUrl: "https://en.wikipedia.org/wiki/X", credit: EVIL }));
    await new Promise((r) => setTimeout(r, 0));
    document.body.append(root);
    expect(root.textContent).toContain(EVIL);
    expect(root.querySelectorAll("img")).toHaveLength(1); // the real photo only
    expect(root.querySelector("img")!.getAttribute("src")).toBe("https://upload.wikimedia.org/a.jpg");
    noInjectedNodes(root);
    root.remove();
  });

  it("map markers (label and title attributes)", () => {
    const { container } = render(<FakeMapPanel stops={[stop(0)]} routeGeometry={null} onMapClick={vi.fn()} onStopClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: `Stop 1: ${EVIL}` })).toBeTruthy();
    noInjectedNodes(container);
  });

  it("share page", () => {
    const trip: PublicTrip = { name: EVIL, plannedDate: "2026-07-01", departAt: null, stops: [stop(0)].map(({ order, name, lat, lng, notes, source, visited, lightPref, dwellMinutes, shotNotes, shotChecklist }) => ({ order, name, lat, lng, notes, source, visited, lightPref, dwellMinutes, shotNotes, shotChecklist })) };
    const { container } = render(<SharedTripView trip={trip} />);
    expect(container.textContent).toContain(EVIL);
    noInjectedNodes(container);
  });

  it("offline copy", async () => {
    const trip: TripWithStops = { id: "t1", name: EVIL, plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [stop(0)] };
    saveTripCopy(trip, new Date("2026-06-20T12:00:00Z"));
    const { container } = render(<SettingsProvider><OfflineView /></SettingsProvider>);
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(EVIL.slice(0, 10).replace(/[<>]/g, "\\$&")) }));
    expect(container.textContent).toContain(EVIL);
    noInjectedNodes(container);
  });

  it("GPX export escapes the markup", () => {
    const gpx = buildGpx({ name: EVIL, stops: [{ name: EVIL, lat: 1, lng: 2, notes: EVIL }] });
    expect(gpx).not.toContain("<img");
    expect(gpx).not.toContain("<script");
    const doc = new DOMParser().parseFromString(gpx, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("wpt > name")!.textContent).toBe(EVIL);
  });
});
