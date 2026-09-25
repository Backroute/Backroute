import { cloudEnabled } from "./client";

/**
 * The demo: the sample fleet, the AI running on made-up loads, nothing saved or sent. Anyone can open it from /demo
 * without an account, next to the real, signed-in version. It lasts for the browser tab. Without Supabase keys the
 * whole app is the demo.
 *
 * Read it only in effects and event handlers: the server can't see the tab's storage.
 */
const KEY = "backroute-demo";

/**
 * Whether this site has the demo at all. Set NEXT_PUBLIC_DEMO=off on the real site and the demo is gone: no /demo
 * page, no demo links, no sample data, no simulation. Run the demo as its own site (no keys) for as long as you're
 * showing it, then delete that site. Built into the app, so redeploy after changing it.
 */
export const demoAllowed = process.env.NEXT_PUBLIC_DEMO !== "off";

export function inDemo(): boolean {
  if (!demoAllowed) return false;
  if (!cloudEnabled) return true;
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Full page loads on the way in and out, so demo data and a real account never share memory. */
export function startDemo(to: string) {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage blocked: the demo still opens, it just won't survive a reload.
  }
  window.location.assign(to);
}

/** Leaves the demo without reloading: for pages that belong to the real app anyway, like sign-in. */
export function leaveDemo() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

export function exitDemo(to = "/") {
  leaveDemo();
  window.location.assign(to);
}
