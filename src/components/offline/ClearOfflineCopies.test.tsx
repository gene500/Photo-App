// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { listTripCopies, saveTripCopy } from "@/lib/offline-store";
import type { TripWithStops } from "@/lib/types";
import { ClearOfflineCopies } from "./ClearOfflineCopies";

const trip: TripWithStops = { id: "t1", name: "Yosemite loop", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] };

beforeEach(() => {
  installMemoryStorage();
  localStorage.setItem("rtpp.offline.owner", "u1");
  saveTripCopy(trip);
});

describe("ClearOfflineCopies", () => {
  it("wipes saved copies and the owner mark on mount, rendering nothing", () => {
    expect(listTripCopies()).toHaveLength(1);
    const { container } = render(<ClearOfflineCopies />);
    expect(listTripCopies()).toHaveLength(0);
    expect(localStorage.getItem("rtpp.offline.owner")).toBeNull();
    expect(container.innerHTML).toBe("");
  });
});
