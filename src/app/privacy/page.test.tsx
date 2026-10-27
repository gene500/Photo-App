import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./page";

describe("privacy page", () => {
  it("says the email in sign-up and login counters is kept as typed, not hashed", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain("the email address used in a sign-up or login attempt");
    expect(html).not.toContain("using only a hashed form");
  });
});
