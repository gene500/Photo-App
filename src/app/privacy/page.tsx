import type { Metadata } from "next";
import { CONTACT_URL, LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy · Photo Op Planner" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>Photo Op Planner helps you plan photo trips: stops, routes, and the best light. This page explains what it stores, who else sees data when you use it, and the choices you have.</p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Account:</strong> your email address and a salted hash of your password (never the password itself).</li>
        <li><strong>Your trips:</strong> trip names, dates, stops and their coordinates, notes, shot lists, and the photos you upload to a stop.</li>
        <li><strong>Share links:</strong> if you create a share link, anyone who has it can see that trip&apos;s stops with their exact locations, notes, shot lists and progress, times and light preferences (but not photos) until you turn the link off.</li>
        <li><strong>Settings:</strong> display preferences such as theme, text size and time format.</li>
      </ul>

      <h2>On your device</h2>
      <ul>
        <li>A sign-in cookie that keeps you logged in (up to 30 days). It is required for the app to work; we use no advertising or analytics cookies.</li>
        <li>Browser storage (localStorage) for your settings and for offline copies of your trips. Signing out clears the offline copies.</li>
        <li>A small service-worker cache so the offline page and app assets load without a connection.</li>
      </ul>

      <h2>Services that receive data</h2>
      <p>To do its job the app sends limited data to these providers. We do not sell your data or use it for advertising.</p>
      <ul>
        <li><strong>Hosting and database</strong> (Vercel, Turso) store the account and trip data above. <strong>Vercel Blob</strong> stores uploaded photos.</li>
        <li><strong>Mapbox</strong> draws the map and provides routes and place search. It receives the map areas you view, coordinates for directions and search text, and your browser&apos;s IP address.</li>
        <li><strong>Open-Meteo</strong> provides weather. It receives the coordinates (to about 1 km) of stops and suggested places you view, and the dates involved; for dates far ahead it is asked about the same date in past years.</li>
        <li><strong>OpenStreetMap / Overpass</strong> and <strong>Wikimedia Commons</strong> (and Flickr, if enabled) supply nearby places and photo counts. They receive the area being searched, not your identity.</li>
        <li>Images for places may load directly from Mapbox, Wikimedia or Flickr servers, which see your IP address like any website.</li>
      </ul>

      <h2>Security</h2>
      <p>Passwords are hashed, traffic uses HTTPS, and access to a trip requires being its owner or having its share link. No system is perfectly secure, so use a unique password. &quot;Sign out on all devices&quot; in Settings ends every session.</p>

      <h2>Retention and deletion</h2>
      <p>We keep your data while your account exists. You can delete your account yourself in Settings (&ldquo;Delete account&rdquo;, confirmed with your password); this permanently removes your account, trips, stops and uploaded photos. To get a copy of your data, contact us using the link below. Deleting an individual trip or photo in the app removes it too. Backups kept by our hosting providers may take a short time to expire.</p>

      <h2>Children</h2>
      <p>The service is not directed to children under 13 and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the date above will change. Material changes will be noted in the app.</p>

      <h2>Contact</h2>
      <p>Questions or requests: <a href={CONTACT_URL}>open an issue</a> on the project page (do not post private information there; say you want a private reply and we will arrange one).</p>
    </LegalPage>
  );
}
