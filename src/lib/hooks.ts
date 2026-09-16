"use client";

import { useRef, useSyncExternalStore } from "react";

export function useNow(intervalMs = 1000) {
  const ref = useRef<number | null>(null);

  return useSyncExternalStore(
    (callback) => {
      ref.current = Date.now();
      const id = setInterval(() => {
        ref.current = Date.now();
        callback();
      }, intervalMs);
      return () => clearInterval(id);
    },
    () => ref.current,
    () => null,
  );
}

function subscribeNever() {
  return () => {};
}

export function useMounted() {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
