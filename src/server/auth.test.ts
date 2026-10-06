import { beforeEach, describe, expect, it } from "vitest";
import { authOptions, authorizeCredentials } from "./auth";
import { createUser } from "./users";
import { resetDb } from "../../tests/helpers/db";

describe("auth", () => {
  beforeEach(resetDb);

  it("uses JWT sessions and the /login page", () => {
    expect(authOptions.session?.strategy).toBe("jwt");
    expect(authOptions.pages?.signIn).toBe("/login");
  });

  it("authorizes valid credentials and rejects missing fields", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    expect(await authorizeCredentials({ email: "ann@example.com", password: "correct-horse" })).toEqual(user);
    expect(await authorizeCredentials({ email: "ann@example.com" })).toBeNull();
    expect(await authorizeCredentials(undefined)).toBeNull();
  });
});
