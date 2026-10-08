import type { Metadata } from "next";
import { OfflineView } from "@/components/offline/OfflineView";

// Static, public shell cached by the service worker. It never calls the server: everything it shows
// comes from the copies saved in this browser, so it is safe to serve with no session at all.
export const metadata: Metadata = {
  title: "Offline · Photo Op Planner",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return <OfflineView />;
}
