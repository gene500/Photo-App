import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

describe("unknown /api paths", () => {
  it("answer a JSON 404 with no-store, not the HTML page", async () => {
    const res = await GET(new Request("http://localhost/api/nonexist"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Not found" });
  });
  it("still refuses a cross-site POST first", async () => {
    expect((await POST(new Request("http://localhost/api/x", { method: "POST", headers: { origin: "https://evil.example" } }))).status).toBe(403);
  });
});
