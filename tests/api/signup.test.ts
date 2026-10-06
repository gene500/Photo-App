import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/signup/route";
import { prisma } from "@/server/db";
import { resetDb } from "../helpers/db";
import { jsonRequest } from "../helpers/requests";

describe("POST /api/signup", () => {
  beforeEach(resetDb);

  it("creates an account and returns 201 without the hash", async () => {
    const res = await POST(jsonRequest("POST", "/api/signup", { email: "Ann@Example.com", password: "correct-horse" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ user: { id: expect.any(String), email: "ann@example.com" } });
    expect(await prisma.user.count()).toBe(1);
  });

  it("returns 409 for a duplicate email", async () => {
    await POST(jsonRequest("POST", "/api/signup", { email: "ann@example.com", password: "correct-horse" }));
    const res = await POST(jsonRequest("POST", "/api/signup", { email: "ann@example.com", password: "other-pass" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "An account with that email already exists" });
  });

  it("returns 400 for invalid input", async () => {
    const res = await POST(jsonRequest("POST", "/api/signup", { email: "not-an-email", password: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("email: Enter a valid email address");
  });
});
