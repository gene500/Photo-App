// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../tests/helpers/memory-storage";
import { enableOfflineSaving, listTripCopies, saveTripCopy } from "@/lib/offline-store";

const signOut = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (o: unknown) => signOut(o) }));
const signOutEverywhere = vi.fn();
vi.mock("@/lib/api-client", () => ({ api: { signOutEverywhere: () => signOutEverywhere() } }));
import { SignOutButton, SignOutEverywhereButton } from "./SignOutButton";

beforeEach(() => {
  installMemoryStorage();
  localStorage.setItem("rtpp.offline.owner", "u1"); // a signed-in page has claimed the device
  signOut.mockReset();
});

describe("SignOutButton", () => {
  it("clears the offline copies before signing out", async () => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    expect(listTripCopies()).toHaveLength(1);
    let copiesAtSignOut = -1;
    signOut.mockImplementation(() => { copiesAtSignOut = listTripCopies().length; });
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
    expect(copiesAtSignOut).toBe(0);
    expect(listTripCopies()).toEqual([]);
  });

  it("switches saving off so a late autosave cannot restore a copy", async () => {
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] })).toBe(false);
    enableOfflineSaving();
  });
});

describe("SignOutEverywhereButton", () => {
  it("revokes sessions on the server, clears copies, then signs this device out", async () => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    signOutEverywhere.mockResolvedValue(undefined);
    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out on all devices" }));
    expect(signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
    expect(listTripCopies()).toEqual([]);
    enableOfflineSaving();
  });

  it("stays signed in and shows the error when the server call fails", async () => {
    signOutEverywhere.mockRejectedValue(new Error("Not signed in"));
    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out on all devices" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not signed in");
    expect(signOut).not.toHaveBeenCalled();
  });
});
