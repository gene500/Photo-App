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

  it("discloses location use, Google sign-in, hike data sources, session storage and the suggestion cache", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);
    for (const text of [
      "Start from my location",
      "only when it is within 500 km",
      "do not save it to your account, cache it, or write it to our logs",
      "Sign in with Google",
      "National Park Service",
      "session storage",
      "Photo-spot suggestions",
      "is kept in our database until the cookie would have expired",
      "removal is retried daily",
      "no stop is added",
      "stored on your device only; a couple of values, the route focus for Optimize and the default time at a stop, are sent with the request that uses them",
    ]) expect(html).toContain(text);
  });

  it("legal pages are dated November 10, 2026", () => {
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain("Last updated November 10, 2026");
    expect(renderToStaticMarkup(<TermsPage />)).toContain("Last updated November 10, 2026");
  });

  it("renders the terms and links back to the privacy policy", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    expect(html).toContain("Terms of Service");
    expect(html).toContain('href="/privacy"');
    for (const text of ["Google&#x27;s own terms", "National Park Service", "Open-Meteo", "Using your location for Optimize is optional"]) expect(html).toContain(text);
  });

  it("both pages start with a skip link to the main content", () => {
    for (const page of [<PrivacyPage key="p" />, <TermsPage key="t" />]) {
      const html = renderToStaticMarkup(page);
      expect(html).toContain('href="#main-content"');
      expect(html).toContain('id="main-content"');
    }
  });
});
