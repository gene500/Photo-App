import { describe, expect, it } from "vitest";

import { SHORT_SCREEN_POPOVER } from "./use-popover";

describe("SHORT_SCREEN_POPOVER", () => {
  const classes = SHORT_SCREEN_POPOVER.split(/\s+/);

  it("puts the portrait phone panel below the floating search bar and keeps it scrollable", () => {
    expect(classes).toContain("max-lg:[@media(min-height:30.0625rem)]:top-[7.25rem]");
    expect(classes).toContain("max-lg:[@media(min-height:30.0625rem)]:max-h-[calc(100dvh-8.5rem)]");
  });

  it("also clears the search bar on a short portrait screen", () => {
    expect(classes).toContain("max-lg:[@media(max-height:30rem)_and_(orientation:portrait)]:top-[7.25rem]");
  });

  it("leaves the short-landscape layout where it was", () => {
    expect(classes).toContain("[@media(max-height:30rem)_and_(orientation:landscape)]:top-[4.25rem]");
    expect(classes).toContain("[@media(max-height:30rem)_and_(orientation:landscape)]:max-h-[calc(100dvh-5.5rem)]");
  });

  it("caps the width to the window so zoomed popovers cannot overhang the left edge", () => {
    expect(classes).toContain("max-lg:max-w-[calc(100vw-1.5rem)]");
    expect(classes).toContain("[@media(max-height:30rem)_and_(orientation:landscape)]:max-w-[calc(100vw-1.5rem)]");
  });
});
