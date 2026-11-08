// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { installMemoryStorage } from "../../tests/helpers/memory-storage";
import { clearAccountLeftovers, clearAuthMessage } from "./account-leftovers";

beforeEach(() => { installMemoryStorage(); });

it("removes per-account markers only", () => {
  localStorage.setItem("autoFirstStop:t1", "1");
  localStorage.setItem("nextauth.message", "{}");
  localStorage.setItem("rtpp.settings", "keep");
  clearAccountLeftovers();
  expect(localStorage.getItem("autoFirstStop:t1")).toBeNull();
  expect(localStorage.getItem("nextauth.message")).toBeNull();
  expect(localStorage.getItem("rtpp.settings")).toBe("keep");
});

it("clearAuthMessage leaves trip markers", () => {
  localStorage.setItem("autoFirstStop:t1", "1");
  localStorage.setItem("nextauth.message", "{}");
  clearAuthMessage();
  expect(localStorage.getItem("autoFirstStop:t1")).toBe("1");
  expect(localStorage.getItem("nextauth.message")).toBeNull();
});
