import { cloudEnabled } from "./client";

/**
 * The demo: the sample fleet, the AI running on made-up loads, nothing saved or sent. Anyone can open it from /demo
 * without an account, next to the real, signed-in version. It lasts for the browser tab. Without Supabase keys the
 * whole app is the demo.
 *
 * Read it only in effects and event handlers: the server can't see the tab's storage.
 */
const KEY = "backroute-demo";

export function inDemo(): boolean {
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
