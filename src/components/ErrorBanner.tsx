export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="anim-rise flex items-start justify-between gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="-my-1 -mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold hover:bg-hover">
        ×
      </button>
    </div>
  );
}
