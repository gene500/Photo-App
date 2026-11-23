import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/budget", () => ({ getBudgetUsage: vi.fn(), isOwner: vi.fn() }));
import { getBudgetUsage, isOwner } from "@/server/budget";
import { getCurrentUserId } from "@/server/session";
import UsagePage from "./page";

const resetsAt = Date.UTC(2026, 11, 1);
const usage = [
  { product: "mapbox-geocoding", label: "Mapbox place search", used: 120, cap: 8000, allowance: 10000, confirmed: false, resetsAt },
  { product: "mapbox-directions", label: "Mapbox directions", used: 4000, cap: 8000, allowance: 10000, confirmed: true, resetsAt },
  { product: "flickr", label: "Flickr", used: 7, cap: null, allowance: null, confirmed: true, resetsAt },
] as const;

const render = async () => renderToStaticMarkup(await UsagePage());

describe("usage page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(isOwner).mockResolvedValue(true);
    vi.mocked(getBudgetUsage).mockResolvedValue([...usage] as never);
  });

  it("gives a signed-out visitor not-found without reading usage", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    await expect(UsagePage()).rejects.toThrow("NOT_FOUND");
    expect(getBudgetUsage).not.toHaveBeenCalled();
    expect(isOwner).not.toHaveBeenCalled();
  });

  it("gives a non-owner not-found without reading usage", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    await expect(UsagePage()).rejects.toThrow("NOT_FOUND");
    expect(getBudgetUsage).not.toHaveBeenCalled();
  });

  it("gives not-found, not a 500, when the owner lookup throws", async () => {
    vi.mocked(isOwner).mockRejectedValue(new Error("db down"));
    await expect(UsagePage()).rejects.toThrow("NOT_FOUND");
    expect(getBudgetUsage).not.toHaveBeenCalled();
  });

  it("shows the owner one row per product with used, cap, percent, allowance, unconfirmed marker and reset date", async () => {
    const html = await render();
    expect(html).toContain("Mapbox place search");
    expect(html).toContain("Mapbox directions");
    expect(html).toContain("Flickr");
    expect(html).toContain("120");
    expect(html).toContain("8,000");
    expect(html).toContain("10,000");
    expect(html).toContain("50%");
    expect(html).toContain("(1%)");
    expect(html).toContain("December 1, 2026");
    expect(html.match(/unconfirmed/gi)).toHaveLength(1);
    expect(html).toContain("No cap");
  });

  it("shows a short message instead of crashing when the store is down", async () => {
    vi.mocked(getBudgetUsage).mockRejectedValue(new Error("libsql://secret-host connect failed"));
    const html = await render();
    expect(html).toContain("Usage is unavailable right now");
    expect(html).not.toContain("secret-host");
  });
});
