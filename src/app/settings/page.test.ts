import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }) }));
vi.mock("@/server/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/users", () => ({ hasPassword: vi.fn() }));
vi.mock("@/components/settings/SettingsView", () => ({ SettingsView: () => null }));
vi.mock("@/server/budget", () => ({ isOwner: vi.fn() }));
import { isOwner } from "@/server/budget";
import { getCurrentUser } from "@/server/session";
import { hasPassword } from "@/server/users";
import SettingsPage from "./page";

describe("settings page", () => {
  beforeEach(() => vi.mocked(getCurrentUser).mockResolvedValue(null));
  it("sends a logged-out visitor to log in and back to settings", async () => {
    await expect(SettingsPage()).rejects.toThrow("REDIRECT:/login?callbackUrl=%2Fsettings");
  });
  it("passes isOwner to the view, and false when the lookup fails", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: "a@b.c" });
    vi.mocked(hasPassword).mockResolvedValue(true);
    vi.mocked(isOwner).mockResolvedValue(true);
    expect((await SettingsPage() as { props: { isOwner: boolean } }).props.isOwner).toBe(true);
    vi.mocked(isOwner).mockRejectedValue(new Error("down"));
    expect((await SettingsPage() as { props: { isOwner: boolean } }).props.isOwner).toBe(false);
  });
});
