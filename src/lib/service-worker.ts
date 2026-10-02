"use client";

/**
 * One service worker for push and for opening with no signal. The offline copy of the app only runs in a built app
 * (`?offline=1`): in development it would hold on to pages that are still changing. Every registration uses the same
 * address, so registering for push never swaps the worker out.
 */
export const SW_URL = process.env.NODE_ENV === "production" ? "/sw.js?offline=1" : "/sw.js";

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" }).catch(() => null);
}
