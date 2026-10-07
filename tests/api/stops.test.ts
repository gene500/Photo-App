import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { POST as addPOST } from "@/app/api/trips/[id]/stops/route";
import { PUT as orderPUT } from "@/app/api/trips/[id]/stops/order/route";
import { DELETE, PATCH } from "@/app/api/stops/[id]/route";
import { MAX_ROUTE_WAYPOINTS } from "@/lib/validation";
import { createTrip, getTrip } from "@/server/trips";
import { createTestUser, resetDb, sampleTripInput } from "../helpers/db";
import { idParams, jsonRequest } from "../helpers/requests";

const signInAs = (id: string | null) => vi.mocked(getCurrentUserId).mockResolvedValue(id);
let userId: string;
let tripId: string;

async function add(name: string, source: "manual" | "suggested" = "manual") {
  const res = await addPOST(
    jsonRequest("POST", `/api/trips/${tripId}/stops`, { name, lat: 37.7, lng: -119.6, source }),
    idParams(tripId),
  );
  return { res, stop: (await res.clone().json()).stop as { id: string; order: number } };
}

describe("stop routes", () => {
  beforeEach(async () => {
    await resetDb();
    userId = (await createTestUser()).id;
    tripId = (await createTrip(userId, sampleTripInput)).id;
    signInAs(userId);
  });

  it("adds stops at increasing order (201)", async () => {
    const a = await add("Tunnel View");
    const b = await add("Olmsted Point", "suggested");
    expect(a.res.status).toBe(201);
    expect([a.stop.order, b.stop.order]).toEqual([0, 1]);
  });

  it("rejects a stop beyond the route waypoint limit with 400", async () => {
    for (let i = 0; i < MAX_ROUTE_WAYPOINTS; i++) expect((await add(`Stop ${i}`)).res.status).toBe(201);
    const { res } = await add("One too many");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `A trip can have at most ${MAX_ROUTE_WAYPOINTS} stops` });
  });

  it("returns 404 adding to another user's trip", async () => {
    signInAs((await createTestUser()).id);
    const { res } = await add("x");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Trip not found" });
  });

  it("returns 400 for an invalid stop", async () => {
    const res = await addPOST(
      jsonRequest("POST", `/api/trips/${tripId}/stops`, { name: "x", lat: 200, lng: 0, source: "manual" }),
      idParams(tripId),
    );
    expect(res.status).toBe(400);
  });

  it("patches visited and notes", async () => {
    const { stop } = await add("a");
    const res = await PATCH(jsonRequest("PATCH", `/api/stops/${stop.id}`, { visited: true, notes: "ND filter" }), idParams(stop.id));
    expect((await res.json()).stop).toMatchObject({ visited: true, notes: "ND filter" });
  });

  it("returns 404 patching another user's stop", async () => {
    const { stop } = await add("a");
    signInAs((await createTestUser()).id);
    const res = await PATCH(jsonRequest("PATCH", `/api/stops/${stop.id}`, { visited: true }), idParams(stop.id));
    expect(res.status).toBe(404);
  });

  it("deletes a stop (204)", async () => {
    const { stop } = await add("a");
    const res = await DELETE(jsonRequest("DELETE", `/api/stops/${stop.id}`), idParams(stop.id));
    expect(res.status).toBe(204);
    expect((await getTrip(userId, tripId))!.stops).toHaveLength(0);
  });

  it("reorders stops", async () => {
    const a = (await add("a")).stop;
    const b = (await add("b")).stop;
    const res = await orderPUT(jsonRequest("PUT", `/api/trips/${tripId}/stops/order`, { stopIds: [b.id, a.id] }), idParams(tripId));
    expect((await res.json()).stops.map((s: { id: string }) => s.id)).toEqual([b.id, a.id]);
  });

  it("returns 400 for a reorder that is not a permutation", async () => {
    const a = (await add("a")).stop;
    await add("b");
    const res = await orderPUT(jsonRequest("PUT", `/api/trips/${tripId}/stops/order`, { stopIds: [a.id] }), idParams(tripId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("stopIds must list every stop in the trip exactly once");
  });
});
