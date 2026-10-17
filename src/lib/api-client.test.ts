import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api-client";

const SESSION = "11111111-1111-4111-8111-111111111111";
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => fetchMock.mockReset());

describe("api client", () => {
  it("sends JSON and unwraps the envelope", async () => {
    fetchMock.mockResolvedValue(Response.json({ stop: { id: "s1" } }, { status: 201 }));
    const res = await api.addStop("t1", { name: "x", lat: 1, lng: 2, source: "manual" });
    expect(res.stop.id).toBe("s1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/trips/t1/stops");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("throws ApiError with the server's message", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Trip not found" }, { status: 404 }));
    await expect(api.updateTrip("t1", { name: "x" })).rejects.toEqual(new ApiError(404, "Trip not found"));
  });

  it("turns a network failure into a friendly message", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.deleteStop("s1")).rejects.toThrow("You're offline or the server can't be reached. Try again.");
  });

  it("handles 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteStop("s1")).resolves.toBeUndefined();
  });

  it("uploads photos as multipart without a JSON content type", async () => {
    fetchMock.mockResolvedValue(Response.json({ stop: { id: "s1" } }));
    await api.uploadPhoto("s1", new File(["x"], "a.png", { type: "image/png" }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/stops/s1/photo");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
  });

  it("encodes geocode queries", async () => {
    fetchMock.mockResolvedValue(Response.json({ suggestions: [] }));
    await api.geocode("Lee Vining, CA", SESSION);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/geocode?q=Lee%20Vining%2C%20CA&session=${SESSION}`);
  });

  it("adds a proximity bias to geocode requests", async () => {
    fetchMock.mockResolvedValue(Response.json({ suggestions: [] }));
    await api.geocode("Spring", SESSION, { lat: 36.74, lng: -119.79 });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/geocode?q=Spring&session=${SESSION}&proximity=-119.790000,36.740000`);
  });

  it("retrieves a picked suggestion with its session", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ place: { name: "H", lat: 1, lng: 2 } })));
    const { place } = await api.retrievePlace("a/b=", SESSION);
    expect(place.name).toBe("H");
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/geocode/retrieve?id=a%2Fb%3D&session=${SESSION}`);
  });

  it("reverse geocodes a point", async () => {
    fetchMock.mockResolvedValue(Response.json({ place: { name: "X", lat: 1, lng: 2 } }));
    const { place } = await api.reverseGeocode(1, 2);
    expect(place.name).toBe("X");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reverse-geocode?lat=1.000000&lng=2.000000");
  });

  it("looks up a place photo, encoding the name", async () => {
    fetchMock.mockResolvedValue(Response.json({ photo: null }));
    const { photo } = await api.placePhoto({ name: "A & B/C", lat: 1, lng: 2 });
    expect(photo).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/place-photo?lat=1.000000&lng=2.000000&name=A%20%26%20B%2FC");
  });

  it("asks the server for the fastest order of the coordinates", async () => {
    fetchMock.mockResolvedValue(Response.json({ order: [0, 2, 1] }));
    const res = await api.optimizeOrder([[0, 0], [2, 2], [1, 1]]);
    expect(res.order).toEqual([0, 2, 1]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/optimize");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ coordinates: [[0, 0], [2, 2], [1, 1]] });
  });
});
