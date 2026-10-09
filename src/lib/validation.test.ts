import { describe, expect, it } from "vitest";
import { signupSchema } from "./validation";

describe("signupSchema", () => {
  it("rejects an email longer than 254 characters", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.com`;
    expect(email.length).toBeGreaterThan(254);
    expect(signupSchema.safeParse({ email, password: "correct-horse" }).success).toBe(false);
  });

  it("rejects a password over bcrypt's 72-byte limit (bcrypt would silently ignore the rest)", () => {
    const multibyte = "é".repeat(60); // 60 characters but 120 bytes
    expect(signupSchema.safeParse({ email: "a@example.com", password: multibyte }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "a@example.com", password: "x".repeat(73) }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "a@example.com", password: "x".repeat(72) }).success).toBe(true);
  });
});
