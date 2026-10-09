import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_URL, LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Terms of Service · Photo Op Planner" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>By creating an account or using Photo Op Planner you agree to these terms. If you do not agree, do not use the service.</p>

      <h2>The service</h2>
      <p>Photo Op Planner is a trip-planning tool. It is provided &quot;as is&quot; and may change, be interrupted, or be discontinued at any time.</p>

      <h2>Your account</h2>
      <ul>
        <li>You must give a real email address and keep your password secret. You are responsible for activity on your account.</li>
        <li>You must be at least 13 years old.</li>
        <li>We may suspend or remove accounts that break these terms or abuse the service.</li>
      </ul>

      <h2>Your content</h2>
      <p>You keep ownership of the trips, notes and photos you add. You give us permission to store, process and display them as needed to run the service, including to people you share a link with. Only upload photos you have the right to use, and nothing illegal.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No attempts to break, probe or overload the service, or to access other people&apos;s data.</li>
        <li>No automated scraping or bulk use of the search, weather, route or place features; they rely on third-party services with their own limits.</li>
        <li>No uploading malware or unlawful content.</li>
      </ul>

      <h2>Safety and accuracy</h2>
      <p>Sun times, weather, route times, place suggestions and opening details are estimates from third-party data and can be wrong or out of date. Check conditions, closures, permits, property boundaries and local laws yourself, and use your own judgment about driving and safety. Do not use the app while driving. Respect private land and wildlife.</p>

      <h2>Third-party services</h2>
      <p>Maps, places, weather and photos come from other providers (see the <Link href="/privacy">Privacy Policy</Link>). Their terms apply to that data, including attribution requirements: map data © Mapbox and © OpenStreetMap contributors.</p>

      <h2>Disclaimer and liability</h2>
      <p>To the fullest extent the law allows, the service is provided without warranties of any kind, and we are not liable for indirect or consequential losses, lost data, missed shots, travel costs, or any injury or loss arising from use of the service. Keep your own copy of anything important. Nothing here limits liability that cannot be limited by law.</p>

      <h2>Ending</h2>
      <p>You can stop using the service at any time and ask for your account to be deleted (see the Privacy Policy). We may end or change the service with or without notice.</p>

      <h2>Changes</h2>
      <p>We may update these terms; continuing to use the service after a change means you accept it. The date above shows the latest version.</p>

      <h2>Contact</h2>
      <p>Questions: <a href={CONTACT_URL}>open an issue</a> on the project page.</p>
    </LegalPage>
  );
}
