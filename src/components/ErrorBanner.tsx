import { SESSION_EXPIRED } from "@/lib/session-expired";
import { loginUrl } from "@/lib/safe-callback";

export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="anim-rise flex items-start justify-between gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
      <span>
        {message}
        {message === SESSION_EXPIRED && (
          <>
            {" "}
            {/* The page the person is on comes back after logging in (their unsaved edit does not, so it is worth copying first). */}
            <a href={loginUrl(typeof window === "undefined" ? null : window.location.pathname)} className="font-medium underline">Log in</a>
          </>
        )}
      </span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="-my-1 -mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold hover:bg-hover">
        ×
      </button>
    </div>
  );
}
