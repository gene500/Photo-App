import { describe, expect, it, vi } from "vitest";
import alertsFixture from "../../../tests/fixtures/nps-alerts.json";
import parksFixture from "../../../tests/fixtures/nps-parks.json";
import { createNpsClient, NPS_ALERTS_TTL_MS, NPS_FAILURE_TTL_MS, NPS_PARKS_TTL_MS } from "./nps-alerts";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
function router(over: Partial<Record<"parks" | "alerts", () => Response>> = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/parks")) return over.parks ? over.parks() : ok(parksFixture);
    return over.alerts ? over.alerts() : ok(alertsFixture);
  });
}
const point = { lat: 37.91, lng: -119.26 };

describe("NPS client", () => {
  it("does nothing and makes no request without a key", async () => {
    const f = router();
    const c = createNpsClient({ fetchImpl: f as unknown as typeof fetch, key: () => null });
    expect(await c.alertsForPoints([point])).toEqual([[]]);
    expect(f).not.toHaveBeenCalled();
  });
  it("sends the key as a header (not in the URL) with a User-Agent, and returns closure and road alerts for the nearest park", async () => {
    const f = router();
    const c = createNpsClient({ fetchImpl: f as unknown as typeof fetch, key: () => "test-key-value" });
    const res = await c.alertsForPoints([point, { lat: 40, lng: -100 }]);
    expect(res[0]).toEqual([
      { kind: "closed", text: "Tioga Road closed for the season (NPS alert)" },
      { kind: "alert", text: "Glacier Point Road closed to vehicles past Badger Pass (NPS alert)" },
      { kind: "alert", text: "Road closed (NPS alert)" },
    ]);
    expect(res[1]).toEqual([]);
    for (const [url, init] of f.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).not.toContain("test-key-value");
      expect(url.startsWith("https://developer.nps.gov/api/v1/")).toBe(true);
      expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key-value");
      expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^RoadTripPhotoPlanner/);
    }
    expect(String(f.mock.calls[1]![0])).toContain("parkCode=yose");
  });
  it("caches parks for a day and alerts for an hour", async () => {
    let t = 0;
    const f = router();
    const c = createNpsClient({ fetchImpl: f as unknown as typeof fetch, key: () => "k", now: () => t });
    await c.alertsForPoints([point]);
    await c.alertsForPoints([point]);
    expect(f).toHaveBeenCalledTimes(2);
    t = NPS_ALERTS_TTL_MS + 1;
    await c.alertsForPoints([point]);
    expect(f).toHaveBeenCalledTimes(3); // alerts again, parks cached
    t = NPS_PARKS_TTL_MS + 1;
    await c.alertsForPoints([point]);
    expect(f).toHaveBeenCalledTimes(5);
  });
  it("yields nothing on a rate limit, a network error or a broken body, and remembers the failure briefly", async () => {
    let t = 0;
    const f = router({ parks: () => new Response("slow down", { status: 429 }) });
    const c = createNpsClient({ fetchImpl: f as unknown as typeof fetch, key: () => "k", now: () => t });
    expect(await c.alertsForPoints([point])).toEqual([[]]);
    expect(await c.alertsForPoints([point])).toEqual([[]]);
    expect(f).toHaveBeenCalledTimes(1);
    t = NPS_FAILURE_TTL_MS + 1;
    await c.alertsForPoints([point]);
    expect(f).toHaveBeenCalledTimes(2);

    const boom = createNpsClient({ fetchImpl: (async () => { throw new Error("net"); }) as unknown as typeof fetch, key: () => "k" });
    expect(await boom.alertsForPoints([point])).toEqual([[]]);
    const bad = createNpsClient({ fetchImpl: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch, key: () => "k" });
    expect(await bad.alertsForPoints([point])).toEqual([[]]);
    const alertsFail = createNpsClient({ fetchImpl: router({ alerts: () => new Response("", { status: 500 }) }) as unknown as typeof fetch, key: () => "k" });
    expect(await alertsFail.alertsForPoints([point])).toEqual([[]]);
  });
});
