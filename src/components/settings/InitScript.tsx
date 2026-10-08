import { SETTINGS_INIT_SCRIPT } from "@/lib/settings";

/**
 * Applies the saved theme/text size before first paint. The content is a constant (never user data). React warns
 * about <script> in client renders, so the client copy is typed text/plain (it never needs to run again).
 */
export function InitScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SETTINGS_INIT_SCRIPT }}
    />
  );
}
