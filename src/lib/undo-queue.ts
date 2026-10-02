"use client";

import { useSyncExternalStore } from "react";

/**
 * A one-move action (a swipe) that waits a few seconds before it counts, with Undo. It lives outside any one screen,
 * so leaving the page doesn't lose it: when its time is up it runs wherever the owner is.
 */
export interface Pending {
  id: string;
  label: string;
  at: number;
}

const WAIT_MS = 5000;
let pending: Pending[] = [];
const runs = new Map<string, { run: () => void; timer: ReturnType<typeof setTimeout> }>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function queueWithUndo(id: string, label: string, run: () => void) {
  if (runs.has(id)) return;
  const timer = setTimeout(() => commit(id), WAIT_MS);
  runs.set(id, { run, timer });
  pending = [...pending, { id, label, at: Date.now() }];
  emit();
}

function commit(id: string) {
  const r = runs.get(id);
  if (!r) return;
  runs.delete(id);
  pending = pending.filter((p) => p.id !== id);
  emit();
  r.run();
}

export function undo(id: string) {
  const r = runs.get(id);
  if (!r) return;
  clearTimeout(r.timer);
  runs.delete(id);
  pending = pending.filter((p) => p.id !== id);
  emit();
}

export function usePending(): Pending[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
    () => pending,
  );
}

/** Closing the tab: what was swiped still happens (the owner meant it), not lost. */
if (typeof window !== "undefined") window.addEventListener("pagehide", () => [...runs.keys()].forEach(commit));
