import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteResult } from "@/lib/types";
import { createShareToken } from "@/server/share";
import { addStop, reorderStops } from "@/server/stops";
import { createTrip, updateTrip } from "@/server/trips";
import { prisma } from "@/server/db";
import { createTestUser, resetDb, sampleTripInput } from "../../../../tests/helpers/db";

const getDirections = vi.fn();
vi.mock("@/server/external/mapbox", () => ({ getDirections: (...a: unknown[]) => getDirections(...a) }));

const mapLoadState = vi.fn();
vi.mock("@/server/budget", () => ({ mapLoadState: () => mapLoadState() }));

import SharedTripPage from "./page";

const route: RouteResult = { geometry: [[-120, 36], [-119, 37]], distance: 1000, duration: 600, legs: [{ distance: 1000, duration: 600 }] };
const spot = (name: string, lat: number, lng: number) => ({ name, lat, lng, source: "manual" as const, lightPref: "any" as const, priority: "normal" as const, dwellMinutes: 30 });

/** What the share page hands its view for a token: the stops in order and the route it was fetched for. */
async function render(token: string) {
  const el = (await SharedTripPage({ params: Promise.resolve({ token }) } as never)) as { props: { trip: { stops: { name: string }[] }; route: RouteResult | null; mapAllowed: boolean } };
  return el.props;
}

describe("share page follows the owner's saved stop order", () => {
  beforeEach(async () => {
    await resetDb();
    getDirections.mockReset();
    mapLoadState.mockReset();
    mapLoadState.mockResolvedValue("ok");
    getDirections.mockResolvedValue(route);
  });

  it("returns the stops in the new order, with the route fetched for that order, after the owner saves an Optimize", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const a = (await addStop(user.id, trip.id, spot("A", 36, -120)))!;
    const b = (await addStop(user.id, trip.id, spot("B", 37, -119)))!;
    const c = (await addStop(user.id, trip.id, spot("C", 38, -118)))!;
    const token = (await createShareToken(user.id, trip.id))!;

    const before = await render(token);
    expect(before.trip.stops.map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(getDirections).toHaveBeenLastCalledWith([[-120, 36], [-119, 37], [-118, 38]]);

    // What the editor's Optimize saves: the new order, then the optimized mark.
    await reorderStops(user.id, trip.id, [c.id, a.id, b.id]);
    await updateTrip(user.id, trip.id, { routeOptimizedFor: "v1:0123456789abcdef" });

    const after = await render(token);
    expect(after.trip.stops.map((s) => s.name)).toEqual(["C", "A", "B"]);
    expect(getDirections).toHaveBeenLastCalledWith([[-118, 38], [-120, 36], [-119, 37]]);
    expect(after.route).toEqual(route);
    // The mark itself is the owner's private state.
    expect(JSON.stringify(after.trip)).not.toContain("routeOptimizedFor");
  });

  it("fetches the route to a stop's saved parking lot instead of the stop", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const a = (await addStop(user.id, trip.id, spot("A", 36, -120)))!;
    await addStop(user.id, trip.id, spot("B", 37, -119));
    await prisma.stop.update({ where: { id: a.id }, data: { accessLat: 36.01, accessLng: -120.02, accessName: "Lot", accessResolvedAt: new Date() } });
    const token = (await createShareToken(user.id, trip.id))!;
    await render(token);
    expect(getDirections).toHaveBeenLastCalledWith([[-120.02, 36.01], [-119, 37]]);
  });

  it("fetches the route to a road end's coordinates, not the stop", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const a = (await addStop(user.id, trip.id, spot("A", 36, -120)))!;
    await addStop(user.id, trip.id, spot("B", 37, -119));
    await prisma.stop.update({ where: { id: a.id }, data: { accessLat: 36.02, accessLng: -120.03, accessName: "Road end", accessKind: "road-end", accessTrail: JSON.stringify([[-120.03, 36.02], [-120, 36]]), accessResolvedAt: new Date() } });
    const token = (await createShareToken(user.id, trip.id))!;
    await render(token);
    expect(getDirections).toHaveBeenLastCalledWith([[-120.03, 36.02], [-119, 37]]);
  });

  it.each([["ok", true], ["warn", true], ["shared-off", false], ["all-off", false]] as const)("passes mapAllowed for map state %s", async (state, allowed) => {
    mapLoadState.mockResolvedValue(state);
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    await addStop(user.id, trip.id, spot("A", 36, -120));
    const token = (await createShareToken(user.id, trip.id))!;
    expect((await render(token)).mapAllowed).toBe(allowed);
  });
});

