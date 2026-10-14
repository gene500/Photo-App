import { describe, expect, it } from "vitest";
import { adoptPrewarm, PREWARM_MAX_AGE_MS, PREWARM_MIN_PLACES, startPrewarm } from "./suggestion-prewarm";
import type { Suggestion } from "./types";

const sug = (i: number): Suggestion => ({ osmId: `node/${i}`, name: `S${i}`, lat: 37 + i / 100, lng: -119, kind: "viewpoint" });
const many = (n: number) => Array.from({ length: n }, (_, i) => sug(i));

describe("suggestion prewarm", () => {
  it("adopts a full list", async () => {
    const found = many(PREWARM_MIN_PLACES);
    expect(await adoptPrewarm(startPrewarm(async () => found, 1000), 2000)).toEqual(found);
  });

  it("does not adopt a thin list (it may be a degraded answer), so the caller searches again", async () => {
    expect(await adoptPrewarm(startPrewarm(async () => many(PREWARM_MIN_PLACES - 1)))).toBeNull();
  });

  it("does not adopt a failed search", async () => {
    expect(await adoptPrewarm(startPrewarm(async () => { throw new Error("down"); }))).toBeNull();
  });

  it("does not adopt a list older than the age limit", async () => {
    const p = startPrewarm(async () => many(10), 0);
    expect(await adoptPrewarm(p, PREWARM_MAX_AGE_MS + 1)).toBeNull();
    expect(await adoptPrewarm(p, PREWARM_MAX_AGE_MS)).not.toBeNull();
  });

  it("makes no popularity requests of its own", async () => {
    // startPrewarm only runs the search it is given; it has no other side effects to count.
    let calls = 0;
    startPrewarm(async () => { calls++; return many(10); });
    expect(calls).toBe(1);
  });
});
