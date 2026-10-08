import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
  const m = manifest();
  it("is an installable standalone app with a beige theme", () => {
    expect(m.name).toBe("Photo Op Planner");
    expect(m.short_name).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBe("#d9c7a3");
    expect(m.start_url).toBe("/trips");
  });
  it("points at icons that exist, including 192 and 512", () => {
    const sizes = m.icons?.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const icon of m.icons ?? []) expect(existsSync(path.join(process.cwd(), "public", icon.src))).toBe(true);
  });
});
