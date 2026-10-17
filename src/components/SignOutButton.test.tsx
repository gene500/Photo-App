// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../tests/helpers/memory-storage";
import { enableOfflineSaving, listTripCopies, saveTripCopy } from "@/lib/offline-store";

const signOut = vi.fn();
const signIn = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (o: unknown) => signOut(o), signIn: (...a: unknown[]) => signIn(...a) }));
const signOutEverywhere = vi.fn();
const deleteAccount = vi.fn();
const changePassword = vi.fn();
vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(readonly status: number, message: string, readonly reason?: string) { super(message); }
  }
  return { ApiError, api: { signOutEverywhere: () => signOutEverywhere(), deleteAccount: (p: unknown) => deleteAccount(p), changePassword: (a: string, b: string) => changePassword(a, b) } };
});
import { ApiError } from "@/lib/api-client";
import { ChangePasswordButton, DeleteAccountButton, SignOutButton, SignOutEverywhereButton } from "./SignOutButton";

beforeEach(() => {
  installMemoryStorage();
  localStorage.setItem("rtpp.offline.owner", "u1"); // a signed-in page has claimed the device
  signOut.mockReset();
});

describe("SignOutButton", () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign } as unknown as Location);
    signOut.mockResolvedValue({ url: "/login" });
  });
  afterEach(() => { enableOfflineSaving(); vi.restoreAllMocks(); });

  it("signs out, then clears the offline copies and switches saving off", async () => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    expect(listTripCopies()).toHaveLength(1);
    let copiesAtSignOut = -1;
    signOut.mockImplementation(async () => { copiesAtSignOut = listTripCopies().length; return { url: "/login" }; });
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login", redirect: false });
    expect(copiesAtSignOut).toBe(1);
    expect(listTripCopies()).toEqual([]);
    expect(assign).toHaveBeenCalledWith("/login");
    expect(saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] })).toBe(false);
  });

  it("offline: says so and leaves the copies and saving untouched", async () => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toContain("offline");
    expect(signOut).not.toHaveBeenCalled();
    expect(listTripCopies()).toHaveLength(1);
    expect(saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] })).toBe(true);
  });

  it("a failed sign-out is caught and keeps the copies", async () => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    signOut.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't sign out");
    expect(listTripCopies()).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("SignOutButton: the server did not sign us out", () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign } as unknown as Location);
  });
  afterEach(() => { enableOfflineSaving(); vi.restoreAllMocks(); });

  it.each([
    ["a 500 body without a url", { message: "There is a problem with the server configuration." }],
    ["an error redirect", { url: "http://localhost/api/auth/error?error=Configuration" }],
    ["a bad-csrf redirect", { url: "http://localhost/api/auth/signout?csrf=true" }],
    ["no answer at all", undefined],
  ])("%s is not a success: copies stay, no redirect, a retry works", async (_label, answer) => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    signOut.mockResolvedValueOnce(answer);
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't sign out");
    expect(listTripCopies()).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
    expect(saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] })).toBe(true);
    signOut.mockResolvedValueOnce({ url: "/login" });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(assign).toHaveBeenCalledWith("/login");
    expect(listTripCopies()).toEqual([]);
  });
});

describe("SignOutEverywhereButton", () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign } as unknown as Location);
    signOut.mockResolvedValue({ url: "/login" });
  });
  afterEach(() => { enableOfflineSaving(); vi.restoreAllMocks(); });

  it("revokes sessions on the server, clears copies, then signs this device out", async () => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    signOutEverywhere.mockResolvedValue(undefined);
    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out on all devices" }));
    expect(signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login", redirect: false });
    expect(assign).toHaveBeenCalledWith("/login");
    expect(listTripCopies()).toEqual([]);
  });

  it("shows an error, and lets the user retry, when this device's sign-out fails afterwards", async () => {
    signOutEverywhere.mockReset();
    signOutEverywhere.mockResolvedValue(undefined);
    signOut.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out on all devices" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't sign out");
    expect(assign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(assign).toHaveBeenCalledWith("/login");
    expect(signOutEverywhere).toHaveBeenCalledTimes(1);
  });

  it("stays signed in and shows the error when the server call fails", async () => {
    signOutEverywhere.mockRejectedValue(new Error("Not signed in"));
    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out on all devices" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not signed in");
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("DeleteAccountButton (Google-only account)", () => {
  beforeEach(() => { signIn.mockReset(); deleteAccount.mockReset(); });

  it("does not print the email in the prompt", async () => {
    render(<DeleteAccountButton hasPassword={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Delete account/ }));
    expect(document.body.textContent).not.toContain("@");
    expect(document.body.textContent).toContain("Type your email address");
  });

  it("on a reauth answer shows the message and a button that forces a fresh Google login", async () => {
    deleteAccount.mockRejectedValue(new ApiError(403, "Please sign in again to delete your account", "reauth"));
    render(<DeleteAccountButton hasPassword={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Delete account/ }));
    await userEvent.type(screen.getByLabelText("Email address"), "me@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Please sign in again to delete your account");
    expect(signOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google again" }));
    expect(signIn).toHaveBeenCalledWith("google", { callbackUrl: window.location.href }, { prompt: "select_account" });
  });
});

describe("DeleteAccountButton and ChangePasswordButton finish with the awaited sign-out", () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    deleteAccount.mockReset();
    changePassword.mockReset();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign } as unknown as Location);
    signOut.mockResolvedValue({ url: "/login" });
  });
  afterEach(() => { enableOfflineSaving(); vi.restoreAllMocks(); });

  it("delete account: signs out without a redirect, then navigates", async () => {
    deleteAccount.mockResolvedValue(undefined);
    render(<DeleteAccountButton />);
    await userEvent.click(screen.getByRole("button", { name: /Delete account/ }));
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login", redirect: false });
  });

  it("delete account: a failing sign-out is shown, not swallowed", async () => {
    deleteAccount.mockResolvedValue(undefined);
    signOut.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<DeleteAccountButton />);
    await userEvent.click(screen.getByRole("button", { name: /Delete account/ }));
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't sign out");
    expect(assign).not.toHaveBeenCalled();
  });

  it("change password: a failing sign-out is shown, not swallowed", async () => {
    changePassword.mockResolvedValue(undefined);
    signOut.mockResolvedValue({ message: "boom" });
    render(<ChangePasswordButton />);
    await userEvent.click(screen.getByRole("button", { name: /Change password/ }));
    await userEvent.type(screen.getByLabelText("Current password"), "oldpassword");
    await userEvent.type(screen.getByLabelText("New password"), "newpassword1");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't sign out");
    expect(assign).not.toHaveBeenCalled();
  });
});
