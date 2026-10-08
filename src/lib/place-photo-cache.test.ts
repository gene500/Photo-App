import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacePhoto } from "./types";

const placePhoto = vi.fn();
vi.mock("./api-client", () => ({ api: { placePhoto: (...a: unknown[]) => placePhoto(...a) } }));
import { FAILURE_TTL_MS, loadPlacePhoto, prefetchPlacePhotos, resetPlacePhotoCache } from "./place-photo-cache";

const photo: PlacePhoto = { url: "https://upload.wikimedia.org/a.jpg", title: "A", pageUrl: "https://en.wikipedia.org/wiki/A", credit: "Photo: Wikipedia" };
const place = { key: "node/1", name: "A", lat: 1, lng: 2 };

describe("loadPlacePhoto", () => {
  beforeEach(() => {
    placePhoto.mockReset();
    resetPlacePhotoCache();
  });

  it("fetches each place once and serves repeats from memory (including 'no photo')", async () => {
    placePhoto.mockResolvedValue({ photo });
    expect(await loadPlacePhoto(place)).toEqual(photo);
    expect(await loadPlacePhoto(place)).toEqual(photo);
    placePhoto.mockResolvedValue({ photo: null });
    expect(await loadPlacePhoto({ ...place, key: "node/2" })).toBeNull();
    expect(await loadPlacePhoto({ ...place, key: "node/2" })).toBeNull();
    expect(placePhoto).toHaveBeenCalledTimes(2);
    expect(placePhoto).toHaveBeenCalledWith({ name: "A", lat: 1, lng: 2 });
  });

  it("shares one in-flight request between concurrent callers", async () => {
    placePhoto.mockResolvedValue({ photo });
    const [a, b] = await Promise.all([loadPlacePhoto(place), loadPlacePhoto(place)]);
    expect(a).toEqual(photo);
    expect(b).toEqual(photo);
    expect(placePhoto).toHaveBeenCalledTimes(1);
  });

  afterEach(() => vi.useRealTimers());

  it("resolves to null on failure, remembers it for 60 s, then retries", async () => {
    vi.useFakeTimers();
    placePhoto.mockRejectedValueOnce(new Error("offline"));
    expect(await loadPlacePhoto(place)).toBeNull();
    placePhoto.mockResolvedValue({ photo });
    vi.advanceTimersByTime(FAILURE_TTL_MS - 1);
    expect(await loadPlacePhoto(place)).toBeNull(); // still cached: no refetch on repeated hovers
    expect(placePhoto).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    expect(await loadPlacePhoto(place)).toEqual(photo);
    expect(placePhoto).toHaveBeenCalledTimes(2);
  });
});

describe("prefetchPlacePhotos", () => {
  beforeEach(() => {
    placePhoto.mockReset();
    resetPlacePhotoCache();
  });

  it("looks up every place in order, a few at a time, and later loads hit the cache", async () => {
    placePhoto.mockImplementation(() => Promise.resolve({ photo: null }));
    const places = Array.from({ length: 6 }, (_, i) => ({ key: `n/${i}`, name: `P${i}`, lat: i, lng: i }));
    prefetchPlacePhotos(places, { concurrency: 2 });
    await vi.waitFor(() => expect(placePhoto).toHaveBeenCalledTimes(6));
    expect(placePhoto.mock.calls.map((c) => c[0].name)).toEqual(["P0", "P1", "P2", "P3", "P4", "P5"]);
    await loadPlacePhoto(places[3]);
    expect(placePhoto).toHaveBeenCalledTimes(6);
  });

  it("never runs more than the concurrency limit at once, and caps the list", async () => {
    let active = 0;
    let peak = 0;
    placePhoto.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { photo: null };
    });
    const places = Array.from({ length: 12 }, (_, i) => ({ key: `m/${i}`, name: `P${i}`, lat: i, lng: i }));
    prefetchPlacePhotos(places, { concurrency: 3, max: 8 });
    await vi.waitFor(() => expect(placePhoto).toHaveBeenCalledTimes(8));
    await new Promise((r) => setTimeout(r, 30));
    expect(peak).toBeLessThanOrEqual(3);
    expect(placePhoto).toHaveBeenCalledTimes(8);
  });

  it("cancel drops places that have not started", async () => {
    placePhoto.mockImplementation(() => new Promise((r) => setTimeout(() => r({ photo: null }), 10)));
    const places = Array.from({ length: 8 }, (_, i) => ({ key: `c/${i}`, name: `P${i}`, lat: i, lng: i }));
    const cancel = prefetchPlacePhotos(places, { concurrency: 2 });
    cancel();
    await new Promise((r) => setTimeout(r, 60));
    expect(placePhoto.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
