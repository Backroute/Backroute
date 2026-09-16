"use client";

import { useSyncExternalStore } from "react";

// A single shared clock, ticking once a second, shared by every useNow() consumer.
// One interval for the whole app instead of one per component avoids the timer
// storm (and the "changed without notify" tearing it can cause) that a
// per-instance useSyncExternalStore ticker runs into once many components mount.
let nowValue = Date.now();
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  setInterval(() => {
    nowValue = Date.now();
    listeners.forEach((listener) => listener());
  }, 1000);
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return nowValue;
}

function getServerSnapshot() {
  return null;
}

export function useNow() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeNever() {
  return () => {};
}

export function useMounted() {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
