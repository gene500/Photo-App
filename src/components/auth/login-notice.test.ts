import { expect, it } from "vitest";
import { loginNotice } from "./login-notice";

it("maps known message codes and ignores the rest", () => {
  expect(loginNotice("password-changed")).toMatch(/Password changed/);
  expect(loginNotice("account-deleted")).toBe("Account deleted.");
  expect(loginNotice("<script>")).toBeNull();
  expect(loginNotice(undefined)).toBeNull();
});
