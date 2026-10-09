"use client";

import { useEffect } from "react";
import { reportBrowserError } from "@/lib/report-error";

/**
 * The whole app failed to load (the root layout itself crashed). It renders its own document, without the app's
 * styles, so it's styled inline and follows the phone's light or dark setting.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportBrowserError(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", colorScheme: "light dark", display: "grid", placeItems: "center", minHeight: "100vh", padding: 16, textAlign: "center" }}>
        <main style={{ maxWidth: 420 }}>
          <title>Backroute</title>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Backroute couldn&apos;t open</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, opacity: 0.8 }}>The team has been told. Your loads and messages are safe; dispatch keeps running. Try again in a moment.</p>
          <button type="button" onClick={() => retry()} style={{ marginTop: 12, padding: "12px 20px", borderRadius: 999, border: 0, background: "#111", color: "#fff", fontSize: 15, fontWeight: 600 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
