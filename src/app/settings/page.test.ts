import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }) }));
vi.mock("@/server/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/users", () => ({ hasPassword: vi.fn() }));
vi.mock("@/components/settings/SettingsView", () => ({ SettingsView: () => null }));
import { getCurrentUser } from "@/server/session";
import SettingsPage from "./page";

describe("settings page", () => {
  beforeEach(() => vi.mocked(getCurrentUser).mockResolvedValue(null));
  it("sends a logged-out visitor to log in and back to settings", async () => {
    await expect(SettingsPage()).rejects.toThrow("REDIRECT:/login?callbackUrl=%2Fsettings");
  });
});
