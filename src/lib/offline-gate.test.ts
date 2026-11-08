// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { installMemoryStorage } from "../../tests/helpers/memory-storage";
import { checkOfflineAccess, COPY_MAX_AGE_MS } from "./offline-gate";
import { listTripCopies, saveTripCopy } from "./offline-store";
import type { TripWithStops } from "./types";

const trip = (id: string): TripWithStops => ({ id, name: id, plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });

beforeEach(() => {
  installMemoryStorage().setItem("rtpp.offline.owner", "u1");
});

it("drops copies older than the maximum age when opened offline, keeps fresh ones", async () => {
  saveTripCopy(trip("old"), new Date(Date.now() - COPY_MAX_AGE_MS - 86_400_000));
  saveTripCopy(trip("new"), new Date());
  expect(await checkOfflineAccess(false)).toBe("show");
  expect(listTripCopies().map((c) => c.id)).toEqual(["new"]);
});
