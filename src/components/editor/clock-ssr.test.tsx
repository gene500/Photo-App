// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Stop } from "@/lib/types";
import { StopCard } from "./StopCard";
import { StopList } from "./StopList";

vi.mock("@/lib/use-weather", () => ({ useWeatherLine: () => null }));

const stop: Stop = {
  id: "a", tripId: "t1", order: 0, name: "Pier", lat: 37, lng: -119, notes: null, source: "manual", photoUrl: null,
  visited: false, lightPref: "sunset", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [],
};
const best = { window: "sunset" as const, at: new Date("2026-07-01T03:00:00Z"), status: "ok" as never } as never;
const arrival = new Date("2026-07-01T03:00:00Z");
const clock = /\d{1,2}:\d{2}\s?(AM|PM)?/i;

describe("clock text waits for the browser (server render has no time-zone dependent text)", () => {
  it("StopList renders no clock time on the server, and one on the client", () => {
    const list = <StopList stops={[stop]} bestTimes={[best]} arrivals={[arrival]} onReorder={vi.fn()} onToggleVisited={vi.fn()} onDelete={vi.fn()} onSelect={vi.fn()} />;
    expect(renderToString(list)).not.toMatch(clock);
    const { container } = render(list);
    expect(container.textContent).toMatch(clock);
  });
  it("StopCard renders no clock time on the server, and one on the client", () => {
    const card = <StopCard stop={stop} bestTime={best} arrival={arrival} onToggleVisited={vi.fn()} onOpenDetails={vi.fn()} onClose={vi.fn()} />;
    expect(renderToString(card)).not.toMatch(clock);
    const { container } = render(card);
    expect(container.textContent).toMatch(clock);
  });
});
