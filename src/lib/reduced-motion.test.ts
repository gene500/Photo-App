// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { motionReduced } from "./reduced-motion";

// QA: the in-app "Reduce motion" setting says it turns off animations, but the map's JS animations only looked at the device setting.
describe("motionReduced", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-reduce-motion");
    vi.unstubAllGlobals();
  });
  const device = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion") }));
  it("is false when neither the device nor the app asks for less motion", () => {
    device(false);
    expect(motionReduced()).toBe(false);
  });
  it("follows the device setting", () => {
    device(true);
    expect(motionReduced()).toBe(true);
  });
  it("follows the in-app Reduce motion setting", () => {
    device(false);
    document.documentElement.setAttribute("data-reduce-motion", "true");
    expect(motionReduced()).toBe(true);
  });
  it("does not throw without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(motionReduced()).toBe(false);
  });
});
