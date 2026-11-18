import { describe, expect, it } from "vitest";
import { hasPrismaCode, photoUrlsOf } from "./prisma-helpers";

describe("hasPrismaCode", () => {
  it("matches only an object whose code equals the given one", () => {
    expect(hasPrismaCode({ code: "P2025" }, "P2025")).toBe(true);
    expect(hasPrismaCode({ code: "P2002" }, "P2025")).toBe(false);
    expect(hasPrismaCode(Object.assign(new Error("x"), { code: "P2003" }), "P2003")).toBe(true);
    for (const v of [null, undefined, "P2025", 7, {}, { code: 2025 }]) expect(hasPrismaCode(v, "P2025")).toBe(false);
  });
});

describe("photoUrlsOf", () => {
  it("drops nulls and keeps order", () => {
    expect(photoUrlsOf([{ photoUrl: "a" }, { photoUrl: null }, { photoUrl: "b" }])).toEqual(["a", "b"]);
    expect(photoUrlsOf([])).toEqual([]);
  });
});
