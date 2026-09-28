"use client";

import { useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/ai/client";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "unsupported" | "off" | "on" | "blocked" | "busy";

/**
 * Push notifications on this phone or computer for what needs the owner. On an iPhone they work once Backroute is
 * added to the home screen (Share → Add to Home Screen).
 */
export function PhoneAlerts() {
  const [state, setState] = useState<State>("busy");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      // Checked once, in the browser.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") return setState("blocked");
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, []);

  async function send(body: Record<string, unknown>) {
    const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });
    return res.ok;
  }

  async function turnOn() {
    setState("busy");
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) });
      if (!(await send({ op: "subscribe", subscription: sub.toJSON() }))) throw new Error("save");
      await send({ op: "test" });
      setState("on");
    } catch {
      setNote("Couldn't turn them on. Try again.");
      setState("off");
    }
  }

  async function turnOff() {
    setState("busy");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await send({ op: "unsubscribe", endpoint: sub.endpoint }).catch(() => false);
      await sub.unsubscribe().catch(() => false);
    }
    setState("off");
  }

  const text: Record<State, string> = {
    unsupported: "This browser can't show alerts. On an iPhone, add Backroute to your home screen first (Share → Add to Home Screen), then open it from there.",
    off: "Get a notification on this device the moment something needs you.",
    on: "On for this device. You'll get a notification when something needs you.",
    blocked: "Notifications are blocked for Backroute in this browser's settings. Allow them there, then come back.",
    busy: "…",
  };
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
          <BellRing className="h-3.5 w-3.5" /> Phone alerts
        </p>
        <p className="text-xs text-ink-500">{note ?? text[state]}</p>
      </div>
      {(state === "off" || state === "on" || state === "busy") && (
        <Button size="sm" variant={state === "on" ? "outline" : "primary"} disabled={state === "busy"} onClick={() => void (state === "on" ? turnOff() : turnOn())}>
          {state === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "on" ? "Turn off" : "Turn on"}
        </Button>
      )}
    </div>
  );
}
