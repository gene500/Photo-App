import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({ ...(await orig<typeof import("@/server/external/mapbox")>()), getDurationMatrix: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { enforcePaidLimit } from "@/server/shared-limit";
import { getDurationMatrix } from "@/server/external/mapbox";
import { POST } from "./route";

const post = () =>
  new Request("http://localhost/api/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ coordinates: [[0, 0], [1, 1], [2, 2]] }),
  });
const matrix = [[0, 1, 2], [1, 0, 1], [2, 1, 0]];

describe("POST /api/optimize: busy answer", () => {
  beforeEach(() => {
    vi.stubEnv("OPTIMIZE_MAX_CONCURRENT", "1");
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getDurationMatrix).mockReset();
    vi.mocked(enforcePaidLimit).mockReset();
  });

  it("a 503 busy answer neither calls Mapbox nor uses up the user's limit", async () => {
    let release!: () => void;
    vi.mocked(getDurationMatrix).mockImplementationOnce(() => new Promise((r) => (release = () => r(matrix))));
    const first = POST(post());
    await vi.waitFor(() => expect(getDurationMatrix).toHaveBeenCalledTimes(1));
    expect(enforcePaidLimit).toHaveBeenCalledTimes(1);

    const busy = await POST(post());
    expect(busy.status).toBe(503);
    expect(busy.headers.get("Retry-After")).toBeTruthy();
    expect(getDurationMatrix).toHaveBeenCalledTimes(1);
    expect(enforcePaidLimit).toHaveBeenCalledTimes(1);

    release();
    expect((await first).status).toBe(200);
  });
});
