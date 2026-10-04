"use client";

/**
 * One service worker for push and for opening with no signal. The offline copy of the app only runs in a built app
 * (`?offline=1`): in development it would hold on to pages that are still changing. Every registration uses the same
 * address, so registering for push never swaps the worker out.
 */
export const SW_URL = process.env.NODE_ENV === "production" ? "/sw.js?offline=1" : "/sw.js";

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  watchOnline();
  return navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" }).catch(() => null);
}

function tell(message: Record<string, unknown>) {
  navigator.serviceWorker?.ready.then((r) => r.active?.postMessage(message)).catch(() => {});
}

let watching = false;
/** Back online (or opened online): Yes / No answers tapped on a notification with no signal go now. */
function watchOnline() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("online", () => tell({ type: "online" }));
  if (navigator.onLine) tell({ type: "online" });
}

/**
 * Saves the trip's map area on the phone (public/sw.js), so the map still draws on the road with no signal. Points are
 * [lat, lon] along the road; thinned to a few hundred. Only in a built app, where the offline copy runs.
 */
export function keepTripMap(style: string, path: [number, number][]) {
  if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator) || path.length < 2) return;
  // The phone's data saver is on: nothing extra is downloaded.
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const every = Math.max(1, Math.ceil(path.length / 300));
  const points = path.filter((_, i) => i % every === 0 || i === path.length - 1);
  tell({ type: "keep-trip-map", style, points });
}

/** Yes / No answers tapped on a notification with no signal, still waiting on the phone to go (public/sw.js). */
export function waitingAnswers(): Promise<number> {
  if (typeof indexedDB === "undefined") return Promise.resolve(0);
  return new Promise((resolve) => {
    const open = indexedDB.open("backroute-sw", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("answers", { keyPath: "id" });
    open.onerror = () => resolve(0);
    open.onsuccess = () => {
      try {
        const q = open.result.transaction("answers").objectStore("answers").count();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    };
  });
}

const STYLE = "https://tiles.openfreemap.org/styles/dark";

/** The map for a load lined up after this one (its two ends and the straight line between), kept ahead too. */
export function keepLoadMap(from: [number, number] | undefined, to: [number, number] | undefined) {
  if (from && to) keepTripMap(STYLE, [from, to]);
}
