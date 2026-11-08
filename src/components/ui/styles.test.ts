import { describe, expect, it } from "vitest";
import { btnAccent, btnDanger, btnGhost, btnIcon, btnPrimary, btnSecondary, inputClass } from "./styles";

describe("shared styles on touch screens", () => {
  it("every button grows to 44px", () => {
    for (const b of [btnPrimary, btnSecondary, btnAccent, btnGhost, btnDanger]) expect(b).toContain("touch:min-h-11");
    expect(btnIcon).toContain("touch:h-11");
    expect(btnIcon).toContain("touch:w-11");
  });
  it("text inputs grow to 44px", () => {
    expect(inputClass).toContain("touch:min-h-11");
  });
});
