import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { GET as listGET, POST } from "@/app/api/trips/route";
import { DELETE, GET, PATCH } from "@/app/api/trips/[id]/route";
import { createTestUser, resetDb, sampleTripInput } from "../helpers/db";
import { idParams, jsonRequest } from "../helpers/requests";

const signInAs = (id: string | null) => vi.mocked(getCurrentUserId).mockResolvedValue(id);

async function createViaApi() {
  const res = await POST(jsonRequest("POST", "/api/trips", sampleTripInput));
  return (await res.json()).trip as { id: string };
}

describe("trip routes", () => {
  beforeEach(async () => {
    await resetDb();
    signInAs((await createTestUser()).id);
  });

  it("returns 401 when signed out", async () => {
    signInAs(null);
    const res = await listGET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in" });
  });

  it("creates a trip (201) and lists it", async () => {
    const res = await POST(jsonRequest("POST", "/api/trips", sampleTripInput));
    expect(res.status).toBe(201);
    const list = await (await listGET()).json();
    expect(list.trips).toHaveLength(1);
    expect(list.trips[0]).toMatchObject({ name: "Sierra loop", stopCount: 0 });
  });

  it("returns 400 for an invalid trip", async () => {
    const res = await POST(jsonRequest("POST", "/api/trips", { ...sampleTripInput, name: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("name: Trip name is required");
  });

  it("returns 404 for another user's trip", async () => {
    const trip = await createViaApi();
    signInAs((await createTestUser()).id);
    const res = await GET(jsonRequest("GET", `/api/trips/${trip.id}`), idParams(trip.id));
    expect(res.status).toBe(404);
  });

  it("gets a trip with its stops", async () => {
    const trip = await createViaApi();
    const res = await GET(jsonRequest("GET", `/api/trips/${trip.id}`), idParams(trip.id));
    expect((await res.json()).trip).toMatchObject({ id: trip.id, stops: [] });
  });

  it("patches a trip", async () => {
    const trip = await createViaApi();
    const res = await PATCH(jsonRequest("PATCH", `/api/trips/${trip.id}`, { plannedDate: "2026-09-01" }), idParams(trip.id));
    expect(res.status).toBe(200);
    expect((await res.json()).trip.plannedDate).toBe("2026-09-01");
  });

  it("deletes a trip (204), after which it is gone", async () => {
    const trip = await createViaApi();
    const res = await DELETE(jsonRequest("DELETE", `/api/trips/${trip.id}`), idParams(trip.id));
    expect(res.status).toBe(204);
    const after = await GET(jsonRequest("GET", `/api/trips/${trip.id}`), idParams(trip.id));
    expect(after.status).toBe(404);
  });
});
