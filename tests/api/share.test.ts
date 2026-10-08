import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { DELETE, POST } from "@/app/api/trips/[id]/share/route";
import { GET as getTripRoute } from "@/app/api/trips/[id]/route";
import { GET as listTripsRoute } from "@/app/api/trips/route";
import SharedTripPage, { generateMetadata } from "@/app/s/[token]/page";
import { prisma } from "@/server/db";
import { getSharedTrip } from "@/server/share";
import { createTestUser, resetDb } from "../helpers/db";
import { idParams, jsonRequest } from "../helpers/requests";

const signInAs = (id: string | null) => vi.mocked(getCurrentUserId).mockResolvedValue(id);
const share = (tripId: string) => POST(jsonRequest("POST", `/api/trips/${tripId}/share`), idParams(tripId));
const revoke = (tripId: string) => DELETE(jsonRequest("DELETE", `/api/trips/${tripId}/share`), idParams(tripId));

const EMAIL = "secret.owner@example.com";
const PHOTO = "/api/photos/private-upload-123.jpg";

async function seed(email?: string) {
  const owner = await createTestUser(email);
  const trip = await prisma.trip.create({
    data: {
      userId: owner.id,
      name: "Coast run",
      plannedDate: new Date("2026-07-01T00:00:00Z"),
      stops: {
        create: [
          { order: 1, name: "Second view", lat: 36.5, lng: -120, source: "suggested", photoUrl: PHOTO, shotNotes: "Use a polarizer", shotChecklist: JSON.stringify([{ text: "Wide shot", done: true }]) },
          { order: 0, name: "First view", lat: 36, lng: -120.2, source: "manual", notes: "Park by the gate", photoUrl: PHOTO },
        ],
      },
    },
    include: { stops: true },
  });
  return { owner, trip };
}

describe("share routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("requires sign-in", async () => {
    signInAs(null);
    expect((await share("x")).status).toBe(401);
    expect((await revoke("x")).status).toBe(401);
  });

  it("creates a 43+ char base64url token and returns the same one on repeat", async () => {
    const { owner, trip } = await seed(EMAIL);
    signInAs(owner.id);
    const first = (await (await share(trip.id)).json()).shareToken as string;
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect((await (await share(trip.id)).json()).shareToken).toBe(first);
    const other = await seed();
    signInAs(other.owner.id);
    expect((await (await share(other.trip.id)).json()).shareToken).not.toBe(first);
  });

  it("another user can neither create nor revoke (404, token untouched)", async () => {
    const { owner, trip } = await seed(EMAIL);
    signInAs(owner.id);
    const token = (await (await share(trip.id)).json()).shareToken as string;
    signInAs((await createTestUser()).id);
    expect((await share(trip.id)).status).toBe(404);
    expect((await revoke(trip.id)).status).toBe(404);
    expect(await getSharedTrip(token)).not.toBeNull();
    // and a stranger cannot create a token on an unshared trip
    const fresh = await seed();
    expect((await share(fresh.trip.id)).status).toBe(404);
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: fresh.trip.id } })).shareToken).toBeNull();
  });

  it("revoking makes the old token 404 and a new share issues a different one", async () => {
    const { owner, trip } = await seed(EMAIL);
    signInAs(owner.id);
    const token = (await (await share(trip.id)).json()).shareToken as string;
    expect((await revoke(trip.id)).status).toBe(204);
    expect(await getSharedTrip(token)).toBeNull();
    await expect(SharedTripPage({ params: Promise.resolve({ token }) } as never)).rejects.toThrow();
    const again = (await (await share(trip.id)).json()).shareToken as string;
    expect(again).not.toBe(token);
  });

  it("shows the token to the owner only, in the trip DTOs", async () => {
    const { owner, trip } = await seed(EMAIL);
    signInAs(owner.id);
    const token = (await (await share(trip.id)).json()).shareToken as string;
    expect((await (await getTripRoute(jsonRequest("GET", "/"), idParams(trip.id))).json()).trip.shareToken).toBe(token);
    expect((await (await listTripsRoute()).json()).trips[0].shareToken).toBe(token);
    signInAs((await createTestUser()).id);
    expect((await getTripRoute(jsonRequest("GET", "/"), idParams(trip.id))).status).toBe(404);
    expect(JSON.stringify((await (await listTripsRoute()).json()))).not.toContain(token);
  });
});

describe("public share data", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function sharedToken() {
    const { owner, trip } = await seed(EMAIL);
    signInAs(owner.id);
    const token = (await (await share(trip.id)).json()).shareToken as string;
    return { owner, trip, token };
  }

  it("rejects malformed or unknown tokens without a DB hit for garbage", async () => {
    await sharedToken();
    for (const t of ["", "short", "x".repeat(43), "../etc/passwd", "a".repeat(200)]) expect(await getSharedTrip(t)).toBeNull();
  });

  it("returns exactly the sanitized DTO, stops in order, with shot data", async () => {
    const { token } = await sharedToken();
    const dto = await getSharedTrip(token);
    expect(dto).toEqual({
      name: "Coast run",
      plannedDate: "2026-07-01",
      departAt: null,
      stops: [
        { order: 0, name: "First view", lat: 36, lng: -120.2, notes: "Park by the gate", source: "manual", visited: false, lightPref: "any", dwellMinutes: 30, shotNotes: null, shotChecklist: [] },
        { order: 1, name: "Second view", lat: 36.5, lng: -120, notes: null, source: "suggested", visited: false, lightPref: "any", dwellMinutes: 30, shotNotes: "Use a polarizer", shotChecklist: [{ text: "Wide shot", done: true }] },
      ],
    });
  });

  it("the DTO never contains email, userId, photoUrl, ids or the token", async () => {
    const { owner, trip, token } = await sharedToken();
    const dto = await getSharedTrip(token);
    const json = JSON.stringify(dto);
    for (const secret of [EMAIL, owner.id, trip.id, ...trip.stops.map((s) => s.id), PHOTO, "private-upload", token]) {
      expect(json).not.toContain(secret);
    }
    for (const key of ["userId", "photoUrl", "email", "shareToken", "tripId", "id\""]) expect(json).not.toContain(key);
    expect(Object.keys(dto!).sort()).toEqual(["departAt", "name", "plannedDate", "stops"]);
    for (const s of dto!.stops) {
      expect(Object.keys(s).sort()).toEqual(
        ["dwellMinutes", "lat", "lightPref", "lng", "name", "notes", "order", "shotChecklist", "shotNotes", "source", "visited"],
      );
    }
  });

  it("the rendered HTML shows the stops but never email, ids, photo url or the token", async () => {
    const { owner, trip, token } = await sharedToken();
    const html = renderToStaticMarkup(await SharedTripPage({ params: Promise.resolve({ token }) } as never));
    expect(html).toContain("First view");
    expect(html).toContain("Use a polarizer");
    expect(html).toContain("Wide shot");
    for (const secret of [EMAIL, owner.id, trip.id, ...trip.stops.map((s) => s.id), PHOTO, "private-upload", token, "photoUrl", "userId", "<img"]) {
      expect(html).not.toContain(secret);
    }
  });

  it("is noindex, nofollow and sends no referrer", async () => {
    const { token } = await sharedToken();
    const meta = await generateMetadata({ params: Promise.resolve({ token }) } as never);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.referrer).toBe("no-referrer");
    const missing = await generateMetadata({ params: Promise.resolve({ token: "nope" }) } as never);
    expect(missing.robots).toEqual({ index: false, follow: false });
    expect(missing.title).toBe("Not found");
  });
});
