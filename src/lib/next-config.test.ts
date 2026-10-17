import { expect, it } from "vitest";
import nextConfig from "../../next.config";

it("does not advertise the framework in an X-Powered-By header", () => {
  expect(nextConfig.poweredByHeader).toBe(false);
});
