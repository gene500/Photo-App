import { beforeEach, describe, expect, it } from "vitest";
import { stopPatchSchema } from "@/lib/validation";
import { createTestUser, resetDb, sampleTripInput } from "../../tests/helpers/db";
import { addStop, mergeShotChecklist, updateStopCascade } from "./stops";
import { createTrip } from "./trips";

const item = (text: string, done = false) => ({ text, done });

describe("mergeShotChecklist", () => {
  const base = [item("A"), item("B"), item("C")];
  it("keeps another tab's ticks that this editor did not touch", () => {
    const stored = [item("A", true), item("B", true), item("C")];
    expect(mergeShotChecklist(stored, base, [item("A"), item("B"), item("C", true)])).toEqual([item("A", true), item("B", true), item("C", true)]);
  });
  it("lets this editor's own change win, keeps shots added elsewhere and lets removed ones stay removed", () => {
    const stored = [item("A", true), item("B"), item("C"), item("New")];
    expect(mergeShotChecklist(stored, base, [item("A"), item("C")])).toEqual([item("A", true), item("C"), item("New")]);
    expect(mergeShotChecklist(stored, base, [item("A", false), item("B", true), item("C")]).slice(0, 2)).toEqual([item("A", true), item("B", true)]);
  });
  it("never exceeds 20 shots", () => {
    const stored = Array.from({ length: 20 }, (_, i) => item(`s${i}`));
    expect(mergeShotChecklist(stored, [], [item("mine")])).toHaveLength(20);
  });
});

describe("PATCH with shotChecklistBase (two tabs on one stop)", () => {
  beforeEach(resetDb);
  it("does not drop the first tab's ticks, and without a base it still replaces", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const initial = [item("1"), item("2"), item("3")];
    const stop = (await addStop(user.id, trip.id, { name: "S", lat: 1, lng: 2, source: "manual", shotChecklist: initial }))!;
    // Tab A ticks 1 and 2 and saves.
    await updateStopCascade(user.id, stop.id, { shotChecklist: [item("1", true), item("2", true), item("3")] }, initial);
    // Stale tab B (still on the initial copy) ticks 3 and saves.
    const b = await updateStopCascade(user.id, stop.id, { shotChecklist: [item("1"), item("2"), item("3", true)] }, initial);
    expect(b!.stop.shotChecklist).toEqual([item("1", true), item("2", true), item("3", true)]);
    // An old client that sends no base keeps the replace behaviour.
    const c = await updateStopCascade(user.id, stop.id, { shotChecklist: [item("1")] });
    expect(c!.stop.shotChecklist).toEqual([item("1")]);
  });
  it("the schema accepts the base but the stored patch never contains it", () => {
    const parsed = stopPatchSchema.parse({ shotChecklist: [item("a")], shotChecklistBase: [item("a")] });
    expect(parsed.shotChecklistBase).toEqual([item("a")]);
  });
});
