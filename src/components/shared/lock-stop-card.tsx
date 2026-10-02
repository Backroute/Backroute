"use client";

import { useState, useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { setLockStop, useLockStop } from "@/lib/next-stop";

/** The driver's switch for "next stop on my lock screen". Turning it on asks to allow notifications if it must. */
export function LockStopCard() {
  const on = useLockStop();
  // iPhones don't keep a notification pinned: it shows, but a swipe clears it until the stop changes.
  const iphone = useSyncExternalStore(
    () => () => {},
    () => /iPhone|iPad|iPod/.test(navigator.userAgent),
    () => false,
  );
  const [note, setNote] = useState<string | null>(null);
  async function change(next: boolean) {
    setNote(null);
    if (!next) return setLockStop(false);
    if (typeof Notification === "undefined") return setNote("This phone's browser can't show it. Add Backroute to your home screen first.");
    const allowed = Notification.permission === "granted" || (await Notification.requestPermission()) === "granted";
    if (!allowed) return setNote("Notifications are off for Backroute. Turn them on in your phone's settings, then try again.");
    setLockStop(true);
  }
  return (
    <section aria-labelledby="lock-stop-title" className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="lock-stop-title" className="t-section text-ink-950">
            Next stop on my lock screen
          </h3>
          <p className="mt-1 text-xs text-ink-500">
            Where you&apos;re headed and the appointment, there when you glance at your phone. No sound. It changes as the trip moves.
            {iphone ? " On iPhone it can be swiped away; it comes back when the stop or time changes." : ""}
          </p>
        </div>
        <Switch checked={on} onChange={(v) => void change(v)} label="Next stop on my lock screen" />
      </div>
      {note && <p className="mt-2 text-xs text-[var(--accent-warn)]">{note}</p>}
    </section>
  );
}
