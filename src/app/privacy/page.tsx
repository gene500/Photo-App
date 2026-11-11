import type { Metadata } from "next";
import { CONTACT_URL, LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy · Photo Op Planner" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>Photo Op Planner helps you plan photo trips: stops, routes, and the best light. This page explains what it stores, who else sees data when you use it, and the choices you have.</p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Account:</strong> your email address and a salted hash of your password (never the password itself). If you sign in with Google, we keep your Google email address and Google&apos;s identifier for your account instead of a usable password; we never see your Google password.</li>
        <li><strong>Your trips:</strong> trip names, dates, stops and their coordinates, notes, shot lists, and the photos you upload to a stop. Location and camera metadata (such as EXIF/GPS) is removed from a photo before it is saved.</li>
        <li><strong>Share links:</strong> if you create a share link, anyone who has it can see that trip&apos;s stops with their exact locations, times and light preferences, and each stop&apos;s shot notes and shot checklist including which items are ticked (but not photos or your private stop notes) until you turn the link off.</li>
        <li><strong>Photo-spot suggestions:</strong> to avoid repeating searches, our database keeps the suggested places found for a map area for a few hours. They are shared between users and are not linked to your account.</li>
      </ul>

      <h2>On your device</h2>
      <ul>
        <li>A sign-in cookie that keeps you logged in (up to 30 days). It is required for the app to work; we use no advertising or analytics cookies.</li>
        <li>Browser storage (localStorage) for your settings (theme, text size, time format and options such as Start from my location, which are stored on your device only; a couple of values, the route focus for Optimize and the default time at a stop, are sent with the request that uses them, and the rest of your settings are not sent to us) and for offline copies of your trips (the most recent 20). Signing out on a device clears its offline copies; copies on another device are cleared when you next sign out or visit the sign-in page there, so remove them in Settings if you lose a device.</li>
        <li>Short-lived browser session storage, which your browser clears when you close the tab, keeps your latest photo-spot suggestions for a trip (for up to 12 hours) and which panel is open, so a reload does not lose them. Older versions of the app may have left small per-trip markers in localStorage; they are removed when you delete that trip or your account.</li>
        <li>A small service-worker cache so the offline page and app assets load without a connection.</li>
      </ul>

      <h2>Services that receive data</h2>
      <p>To do its job the app sends limited data to these providers. We do not sell your data or use it for advertising.</p>
      <ul>
        <li><strong>Hosting and database</strong> (Vercel, Turso) store the account and trip data above. <strong>Vercel Blob</strong> stores uploaded photos.</li>
        <li><strong>Mapbox</strong> draws the map and provides routes and place search. It receives the map areas you view, coordinates for directions and route optimization, search text, the name of a trip that has no stops yet (only to centre the map on it; no stop is added), and your browser&apos;s IP address. Mapbox&apos;s map library may also send it anonymous map-usage statistics under Mapbox&apos;s own policy. Exporting an itinerary PDF loads a static map image from Mapbox showing your stops.</li>
        <li><strong>Your location (optional):</strong> only if you turn on &ldquo;Start from my location&rdquo; in Settings and press Optimize route for a trip planned for today, your browser asks permission and the app reads your position once. It is rounded to about 11 metres and sent to our server only when it is within 500 km of a stop, where it is used as an extra starting point in that one route request to Mapbox. We do not save it to your account, cache it, or write it to our logs. You can refuse or revoke permission in your browser; Optimize then works without it.</li>
        <li><strong>Open-Meteo</strong> provides weather. It receives the coordinates (to about 1 km) of stops and suggested places you view, and the dates involved; for dates far ahead it is asked about the same date in past years.</li>
        <li><strong>OpenStreetMap / Overpass</strong> and <strong>Wikimedia Commons</strong> (and Flickr, if enabled) supply nearby places and photo counts. They receive the area being searched, not your identity. OpenStreetMap servers also supply hike trails and opening hours around a stop you view, and the <strong>National Park Service</strong> supplies park trails (a map query around the stop) and closure alerts (we ask only for a park&apos;s alerts and match stops to parks ourselves). Our servers make these requests, so they see our server rather than your device.</li>
        <li><strong>Google</strong>, only if you choose &ldquo;Sign in with Google&rdquo;: Google handles that sign-in under its own privacy policy and tells us your verified email address and account identifier. The &ldquo;open in Google Maps&rdquo; and &ldquo;open in Apple Maps&rdquo; export links send your stops&apos; coordinates to that service only when you open them. GPX files and PDFs are built on your device.</li>
        <li><strong>Wikimedia Commons, Wikipedia</strong> (and Flickr, if enabled) also find a photo for each place you add or pick from the suggestions. They receive the name and coordinates of that place (typically not for a dropped pin that is only a street address or coordinates), and no account details.</li>
        <li>Images for places may load directly from Mapbox, Wikimedia or Flickr servers, which see your IP address like any website.</li>
        <li><strong>Abuse protection:</strong> to limit repeated requests, our database briefly keeps counters keyed by your account, by your IP address (IPv6 addresses shortened), or by the email address used in a sign-up or login attempt (as typed, lowercased; failed-login counters pair it with a hash of the IP address). They are removed when their time window (at most an hour) ends, even if the account is deleted sooner.</li>
        <li><strong>Hosting logs:</strong> our hosting provider (Vercel) keeps standard request logs under its own policy. Our own code logs error details (such as an error&apos;s type, message and stack, or the name of an uploaded photo file) to diagnose problems; it does not log your password and does not deliberately log your trips or locations.</li>
      </ul>

      <h2>Security</h2>
      <p>Passwords are hashed, traffic uses HTTPS, and access to a trip requires being its owner or having its share link. No system is perfectly secure, so use a unique password. &quot;Sign out on all devices&quot; in Settings ends every session. When you sign out, a random identifier of that session (not your email) is kept in our database until the cookie would have expired, at most 30 days, so a copied cookie stops working. Pages are served with security headers, including a content-security policy and a location permission limited to this site.</p>

      <h2>Retention and deletion</h2>
      <p>We keep your data while your account exists. You can delete your account yourself in Settings (&ldquo;Delete account&rdquo;, confirmed with your password, or your email address if you signed in with Google); this permanently removes your account, trips, stops and uploaded photos. To get a copy of your data, contact us using the link below. Deleting an individual trip or photo in the app removes it too. If a photo file cannot be removed from storage at that moment, its file name is queued and removal is retried daily; contact us if you need one gone sooner. Backups kept by our hosting providers may take a short time to expire.</p>

      <h2>Children</h2>
      <p>The service is not directed to children under 13 and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the date above will change. Material changes will be noted in the app.</p>

      <h2>Contact</h2>
      <p>Questions or requests: <a href={CONTACT_URL}>open an issue</a> on the project page (do not post private information there; say you want a private reply and we will arrange one).</p>
    </LegalPage>
  );
}
