import { reportBrowserError } from "./lib/report-error";

// Errors in people's browsers reach the team (api/errors): ones React catches go through the error pages
// (app/error.tsx, app/global-error.tsx); these are the rest.
try {
  window.addEventListener("error", (event) => reportBrowserError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportBrowserError(event.reason));
} catch {
  // Reporting must never break the app.
}
