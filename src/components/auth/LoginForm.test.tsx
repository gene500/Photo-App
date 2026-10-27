// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn(), getProviders: vi.fn() }));
import { getProviders, signIn } from "next-auth/react";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { listTripCopies, offlineSavingDisabled, disableOfflineSaving, saveTripCopy } from "@/lib/offline-store";
import { LoginForm } from "./LoginForm";

async function submit() {
  await userEvent.type(screen.getByLabelText("Email"), "ann@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("LoginForm", () => {
  beforeEach(() => { vi.clearAllMocks(); installMemoryStorage(); vi.mocked(getProviders).mockResolvedValue({ credentials: {} } as never); });

  it("shows the Google button only when enabled, and starts the Google flow", async () => {
    const { unmount } = render(<LoginForm />);
    expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
    unmount();
    render(<LoginForm google />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signIn).toHaveBeenCalledWith("google", { callbackUrl: "/trips" });
  });

  it("submits by POST if the form is used before the page is interactive, so a password never lands in the URL", () => {
    const { container } = render(<LoginForm />);
    expect(container.querySelector("form")?.getAttribute("method")).toBe("post");
  });

  it("explains a Google sign-in refusal passed in the URL", () => {
    render(<LoginForm google urlError="GoogleEmailInUse" />);
    expect(screen.getByText(/already exists/i)).toBeTruthy();
  });

  it("shows an inline error for bad credentials", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: "CredentialsSignin", ok: false, status: 401, url: null, code: undefined } as never);
    render(<LoginForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid email or password");
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates to /trips on success", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: undefined, ok: true, status: 200, url: "/trips" } as never);
    render(<LoginForm />);
    await submit();
    expect(signIn).toHaveBeenCalledWith("credentials", { email: "ann@example.com", password: "correct-horse", redirect: false });
    expect(push).toHaveBeenCalledWith("/trips");
  });

  it("wipes leftover offline copies when the login page opens, and re-enables saving after a login", async () => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    disableOfflineSaving();
    vi.mocked(signIn).mockResolvedValue({ error: undefined, ok: true, status: 200, url: "/trips" } as never);
    render(<LoginForm />);
    expect(listTripCopies()).toEqual([]);
    expect(offlineSavingDisabled()).toBe(true);
    await submit();
    expect(offlineSavingDisabled()).toBe(false);
  });

  it("says so when the device is offline, without calling the server", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<LoginForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/offline/i);
    expect(signIn).not.toHaveBeenCalled();
    online.mockRestore();
  });

  it("shows a connection message, and keeps the email, when sign-in throws", async () => {
    vi.mocked(signIn).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<LoginForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/reach the server/i);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ann@example.com");
  });

  it("keeps keyboard focus on the submit button after a failed login (it is never truly disabled)", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: "CredentialsSignin", ok: false, status: 401, url: null });
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Log in" });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });

  it("tells a rate-limited login to wait, not that the server is unreachable", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: "CredentialsSignin", ok: false, status: 429, url: null } as never);
    render(<LoginForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/too many/i);
  });

  it("reports a server error as a server problem", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: "Configuration", ok: false, status: 500, url: null } as never);
    render(<LoginForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/server had a problem/i);
  });

  it("does not call signIn (which would reload the page) when the providers endpoint fails", async () => {
    vi.mocked(getProviders).mockResolvedValue(null as never);
    render(<LoginForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/reach the server/i);
    expect(signIn).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ann@example.com");
  });

  it("shows a message when the CSRF request failed instead of failing silently", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: undefined, ok: true, status: 200, url: "http://x/login?csrf=true" } as never);
    render(<LoginForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/expired/i);
    expect(push).not.toHaveBeenCalled();
  });
});
