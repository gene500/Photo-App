import { describe, expect, it } from "vitest";
import { loginUrl, safeCallbackPath } from "./safe-callback";

describe("safeCallbackPath", () => {
  it("accepts same-origin paths", () => {
    expect(safeCallbackPath("/trips/abc")).toBe("/trips/abc");
    expect(safeCallbackPath("/trips?x=1#y")).toBe("/trips?x=1#y");
  });
  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "trips", "", "/a\nb", "/login", "/signup?x=1", null, 5, "/" + "a".repeat(600)])(
    "rejects %j",
    (v) => expect(safeCallbackPath(v)).toBeNull(),
  );
  it("builds the login url", () => {
    expect(loginUrl("/trips/a b")).toBe("/login?callbackUrl=%2Ftrips%2Fa%20b");
    expect(loginUrl("//x")).toBe("/login");
  });
});
