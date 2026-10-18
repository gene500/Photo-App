import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";

describe("legal pages", () => {
  it("renders the privacy policy with its key disclosures", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("name and coordinates of that place");
    for (const term of ["Mapbox", "Open-Meteo", "Vercel Blob", "Sign out on all devices"]) expect(html).toContain(term);
    expect(html).toContain('href="/terms"');
  });

  it("renders the terms and links back to the privacy policy", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    expect(html).toContain("Terms of Service");
    expect(html).toContain('href="/privacy"');
  });
});
