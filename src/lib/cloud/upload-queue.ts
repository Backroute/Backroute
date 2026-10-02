import { create } from "zustand";

/**
 * Photos taken where there's no signal (a dock in a dead zone): kept on the phone (IndexedDB) and sent when it's back,
 * by themselves, even if the app was closed in between. The count shows as "N waiting to send".
 */

export interface Queued {
  id: string;
  kind: string;
  loadId?: string;
  name: string;
  type: string;
  blob: Blob;
  at: number;
}

const DB = "backroute-uploads";
const STORE = "queue";

export const useUploadQueue = create<{ waiting: number }>(() => ({ waiting: 0 }));

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(item: Omit<Queued, "id" | "at">): Promise<string> {
  const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await tx("readwrite", (s) => s.put({ ...item, id, at: Date.now() }));
  await refreshCount();
  return id;
}

export async function queued(): Promise<Queued[]> {
  try {
    return ((await tx("readonly", (s) => s.getAll())) as Queued[]).sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

export async function drop(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  await refreshCount();
}

export async function refreshCount() {
  useUploadQueue.setState({ waiting: (await queued()).length });
}

type Sender = (item: Queued) => Promise<boolean>;
const waiters = new Map<string, (ok: boolean) => void>();
let sender: Sender | null = null;
let flushing = false;

/** Tries everything waiting, oldest first; stops at the first one the network refuses. */
export async function flush() {
  if (flushing || !sender || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  flushing = true;
  try {
    for (const item of await queued()) {
      const ok = await sender(item).catch(() => false);
      if (!ok) break;
      await drop(item.id);
      waiters.get(item.id)?.(true);
      waiters.delete(item.id);
    }
  } finally {
    flushing = false;
  }
}

/** Set once by the uploader: how one queued photo is sent. Sends what's waiting now and whenever signal returns. */
export function startQueue(send: Sender) {
  if (sender || typeof window === "undefined") return;
  sender = send;
  window.addEventListener("online", () => void flush());
  setInterval(() => void flush(), 30_000);
  void refreshCount().then(flush);
}

/** Resolves when a queued photo finally goes (while the app stays open). */
export function whenSent(id: string): Promise<boolean> {
  return new Promise((resolve) => waiters.set(id, resolve));
}
