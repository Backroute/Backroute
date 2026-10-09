/**
 * Sends an error from the browser to api/errors, at most five a page and each kind once. Noise that isn't ours is
 * dropped: a lost connection (common in a truck), browser extensions, cross-site scripts and the ResizeObserver note.
 */

const sent = new Set<string>();

const NOISE = /ResizeObserver loop|Failed to fetch|NetworkError|Load failed|network error|AbortError|aborted|ChunkLoadError|Loading chunk|^Script error\.?$/i;

export function reportBrowserError(err: unknown) {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err ?? "unknown"));
    const message = e.message || String(err);
    if (!message || NOISE.test(message) || NOISE.test(e.name) || /chrome-extension:|moz-extension:|safari-extension:/.test(e.stack ?? "")) return;
    if (sent.size >= 5 || sent.has(message)) return;
    sent.add(message);
    const body = JSON.stringify({ message: message.slice(0, 500), stack: (e.stack ?? "").slice(0, 4000), path: location.pathname, digest: (e as { digest?: string }).digest ?? null });
    if (navigator.sendBeacon?.(`/api/errors`, new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/errors", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Reporting must never break the app.
  }
}
