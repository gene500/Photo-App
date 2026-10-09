import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSignupToken, issueSignupToken } from "./signup-guard";

describe("signup token", () => {
  beforeEach(() => {
    process.env.SIGNUP_MIN_SECONDS = "3";
  });
  afterEach(() => {
    process.env.SIGNUP_MIN_SECONDS = "0";
  });

  it("accepts a token that is old enough", () => {
    const t = issueSignupToken(1_000_000);
    expect(checkSignupToken(t, 1_000_000 + 5_000)).toBe("ok");
  });

  it("rejects a submission that is too fast, and one that is too old", () => {
    const t = issueSignupToken(1_000_000);
    expect(checkSignupToken(t, 1_000_000 + 500)).toBe("too-fast");
    expect(checkSignupToken(t, 1_000_000 + 7 * 3600_000)).toBe("expired");
  });

  it("rejects missing, malformed, forged and tampered tokens", () => {
    const t = issueSignupToken(1_000_000);
    const [ts, mac] = t.split(".");
    expect(checkSignupToken(undefined)).toBe("invalid");
    expect(checkSignupToken("")).toBe("invalid");
    expect(checkSignupToken("abc")).toBe("invalid");
    expect(checkSignupToken(`${ts}.${mac}.x`)).toBe("invalid");
    expect(checkSignupToken(`1.${mac}`, 99_999_999)).toBe("invalid"); // timestamp swapped to look older
    expect(checkSignupToken(`${ts}.${mac!.slice(0, -2)}AA`, 1_100_000)).toBe("invalid");
  });
});
