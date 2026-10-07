import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacePhoto } from "./types";

const placePhoto = vi.fn();
vi.mock("./api-client", () => ({ api: { placePhoto: (...a: unknown[]) => placePhoto(...a) } }));
import { FAILURE_TTL_MS, loadPlacePhoto, resetPlacePhotoCache } from "./place-photo-cache";

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
