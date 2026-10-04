"use client";

import { registerServiceWorker } from "./service-worker";
import { useEffect, useSyncExternalStore } from "react";
import { formatAtStop } from "./stop-time";
import type { Load } from "./types";

/**
 * A driver's next stop on the lock screen: one quiet notification (no sound, no buzz) that stays put and changes as
 * the trip moves: pickup, then delivery, then gone. The closest a web app gets to a lock-screen widget. Opt-in, per
 * phone, and only once notifications are allowed.
 */
const KEY = "backroute.lockStop";
const TAG = "next-stop";
const listeners = new Set<() => void>();

function lockStopOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setLockStop(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
  if (!on) void clearNextStop();
}

export function useLockStop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    lockStopOn,
    () => false,
  );
}

async function registration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
}

async function clearNextStop() {
  const reg = await registration();
  (await reg?.getNotifications({ tag: TAG }))?.forEach((n) => n.close());
}

/** What the notification says for this load, or null when there's no stop ahead. */
function nextStopText(load: Load | null | undefined): { title: string; body: string } | null {
  if (!load) return null;
  const before = ["rate_confirmed", "booked", "dispatched", "at_pickup"].includes(load.stage);
  const after = ["in_transit", "at_delivery"].includes(load.stage);
  if (!before && !after) return null;
  const stop = before ? "pickup" : "delivery";
  const place = before ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`;
  const appt = load.appointments?.[stop];
  // In the dock's own time (with its zone), the way the appointment was made, wherever the phone is.
  const when = appt?.status === "set" && appt.at ? formatAtStop(appt.at, before ? load.lane.originState : load.lane.destState) : before ? load.pickupWindow : load.deliveryWindow;
  const at = load.stage === "at_pickup" || load.stage === "at_delivery";
  return {
    title: `${at ? "At" : "Next:"} ${stop} · ${place}`,
    body: [when && `Appointment ${when}`, load.referenceNumber && `Load ${load.referenceNumber}`].filter(Boolean).join(" · "),
  };
}

/** Keeps the lock-screen notice in step with the driver's current load. */
export function useNextStopNotice(load: Load | null | undefined) {
  const on = useLockStop();
  const text = nextStopText(load);
  const key = text ? `${text.title}|${text.body}` : "";
  useEffect(() => {
    if (!on || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    void (async () => {
      const reg = await registration();
      if (!reg) return;
      if (!text) return clearNextStop();
      await reg.showNotification(text.title, { body: text.body, tag: TAG, silent: true, requireInteraction: true, icon: "/favicon.ico", data: { url: "/driver" } } as NotificationOptions);
    })();
    // `key` holds the text: it re-shows only when the stop or its time changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key]);
}
