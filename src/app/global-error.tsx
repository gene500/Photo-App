"use client";

// Last-resort boundary that replaces the root layout, so it brings its own <html>/<body> and plain styles
// (globals.css and the theme tokens may not be loaded). Shows no error message or digest.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0 }}>
        <main style={{ maxWidth: 360, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#6b6558", fontSize: 14 }}>The app could not be shown. Please try again.</p>
          <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", borderRadius: 12, border: 0, background: "#2a2418", color: "#fff", fontSize: 14, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
