// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { SETTINGS_KEY } from "@/lib/settings";
import { saveTripCopy } from "@/lib/offline-store";
import type { Stop, TripWithStops } from "@/lib/types";
const reloadPage = vi.fn();
const goToLogin = vi.fn();
vi.mock("@/lib/reload", () => ({ reloadPage: () => reloadPage(), goToLogin: () => goToLogin() }));
import { OfflineView } from "./OfflineView";

const stop = (i: number, over: Partial<Stop> = {}): Stop => ({
  id: `s${i}`, tripId: "t1", order: i, name: `Place ${i}`, lat: 37.7, lng: -119.6, notes: null, source: "manual",
  photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 0, shotNotes: null, shotChecklist: [], ...over,
});
const trip: TripWithStops = {
  id: "t1", name: "Yosemite loop", plannedDate: "2026-07-01", departAt: null, shareToken: null,
  stops: [
    stop(0, { name: "Tunnel View", notes: "Arrive early", lightPref: "sunrise", dwellMinutes: 45, shotNotes: "Wide shot of the valley", shotChecklist: [{ text: "Sunrise glow", done: true }, { text: "Long exposure", done: false }] }),
    stop(1, { name: "Glacier Point", visited: true }),
  ],
};

beforeEach(() => {
  goToLogin.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: { id: "u1" } }))); // online, signed in as the owner
  installMemoryStorage();
  localStorage.setItem("rtpp.offline.owner", "u1"); // a signed-in page has claimed the device
});

describe("OfflineView", () => {
  it("explains when nothing is saved", async () => {
    render(<OfflineView />);
    expect(await screen.findByText(/No trips are saved on this device yet/)).toBeTruthy();
  });

  it("does not say you are offline while the browser is online, and has a skip link", async () => {
    saveTripCopy(trip, new Date("2026-06-20T12:00:00Z"));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineView />);
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main-content");
    expect(document.getElementById("main-content")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: /Yosemite loop/ }));
    expect(screen.getByRole("status").textContent).toMatch(/^Showing your saved copy from /);
    vi.restoreAllMocks();
  });

  it("lists saved trips and opens one read-only with the banner, notes, shot list and dwell", async () => {
    saveTripCopy(trip, new Date("2026-06-20T12:00:00Z"));
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineView />);
    await userEvent.click(await screen.findByRole("button", { name: /Yosemite loop/ }));
    onLine.mockRestore();
    expect(screen.getByRole("heading", { name: "Yosemite loop" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/^You're offline - showing your saved copy from /);
    const rows = screen.getAllByTestId("offline-stop");
    expect(rows).toHaveLength(2);
    const first = within(rows[0]);
    expect(first.getByText("Tunnel View")).toBeTruthy();
    expect(first.getByText("Arrive early")).toBeTruthy();
    expect(first.getByText("Wide shot of the valley")).toBeTruthy();
    expect(first.getByText(/Sunrise glow/)).toBeTruthy();
    expect(first.getByText(/Long exposure/)).toBeTruthy();
    expect(first.getByText(/Stay 45 min/)).toBeTruthy();
    expect(first.getByText(/Best at sunrise/)).toBeTruthy();
    expect(within(rows[1]).getByText("Visited")).toBeTruthy();
    expect(screen.getByText(/Planned for 2026-07-01/)).toBeTruthy();
    expect(screen.getByText(/Drive times need a connection/)).toBeTruthy();
    // Read-only: nothing to edit or delete.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /\b(delete|remove|add|save)\b/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /All saved trips/ }));
    expect(screen.getByRole("button", { name: /Yosemite loop/ })).toBeTruthy();
  });

  it("uses the theme tokens (so beige and dark mode apply), not fixed colours", async () => {
    saveTripCopy(trip);
    const { container } = render(<OfflineView />);
    await userEvent.click(await screen.findByRole("button", { name: /Yosemite loop/ }));
    expect(screen.getAllByTestId("offline-stop")[0].className).toContain("bg-surface");
    expect(screen.getAllByTestId("offline-stop")[0].className).toContain("text-foreground");
    expect(screen.getByRole("status").className).toContain("bg-accent-soft");
    expect(container.innerHTML).not.toContain("bg-white");
  });

  it("shows the saved time in the chosen time format", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ timeFormat: "24h" }));
    saveTripCopy(trip, new Date("2026-06-20T15:07:00Z"));
    render(<SettingsProvider><OfflineView /></SettingsProvider>);
    await userEvent.click(await screen.findByRole("button", { name: /Yosemite loop/ }));
    const banner = screen.getByRole("status").textContent ?? "";
    expect(banner).toMatch(/\d{2}:\d{2}/);
    expect(banner).not.toMatch(/AM|PM/);
  });

  it("offers Try again, and says so when the network returns", async () => {
    reloadPage.mockReset();
    render(<OfflineView />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/back online/)).toBeNull();
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.getByText(/You're back online/)).toBeTruthy();
  });
});

describe("OfflineView access check", () => {
  const session = (body: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => (ok ? Response.json(body) : new Response("x", { status: 500 }))));
  const saved = () => JSON.parse(localStorage.getItem("rtpp.offline.index") ?? "[]") as unknown[];

  it("shows the copies while online when the signed-in user owns them", async () => {
    saveTripCopy(trip);
    render(<OfflineView />);
    expect(await screen.findByRole("button", { name: /Yosemite loop/ })).toBeTruthy();
    expect(goToLogin).not.toHaveBeenCalled();
  });

  it("while online and signed out: shows nothing, wipes the copies and sends the visitor to /login", async () => {
    saveTripCopy(trip);
    session({});
    render(<OfflineView />);
    await vi.waitFor(() => expect(goToLogin).toHaveBeenCalled());
    expect(screen.queryByText("Yosemite loop")).toBeNull();
    expect(saved()).toEqual([]);
    expect(localStorage.getItem("rtpp.offline.owner")).toBeNull();
  });

  it("while online as a different user: never shows the previous user's copies", async () => {
    saveTripCopy(trip);
    session({ user: { id: "someone-else" } });
    render(<OfflineView />);
    await screen.findByText(/No trips are saved on this device yet/);
    expect(screen.queryByText("Yosemite loop")).toBeNull();
    expect(saved()).toEqual([]);
  });

  it("shows nothing before the check finishes", () => {
    saveTripCopy(trip);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<OfflineView />);
    expect(screen.queryByText("Yosemite loop")).toBeNull();
  });

  it("when genuinely offline (navigator.onLine false) shows the last signed-in user's copies without any request", async () => {
    saveTripCopy(trip);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineView />);
    expect(await screen.findByRole("button", { name: /Yosemite loop/ })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(goToLogin).not.toHaveBeenCalled();
  });

  it("when the session check cannot be reached, it counts as offline", async () => {
    saveTripCopy(trip);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<OfflineView />);
    expect(await screen.findByRole("button", { name: /Yosemite loop/ })).toBeTruthy();
  });

  it("offline with no owner mark: copies of unknown origin are wiped, not shown", async () => {
    saveTripCopy(trip);
    localStorage.removeItem("rtpp.offline.owner");
    localStorage.setItem("rtpp.offline.index", JSON.stringify([{ id: "t1", name: "Yosemite loop", plannedDate: "2026-07-01", savedAt: new Date().toISOString(), stopCount: 2 }]));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineView />);
    await screen.findByText(/No trips are saved on this device yet/);
    expect(screen.queryByText("Yosemite loop")).toBeNull();
  });
});
