"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { useSyncStatus } from "@/lib/cloud/sync";
import { refreshCount, useUploadQueue } from "@/lib/cloud/upload-queue";
import { useStore } from "@/lib/store";
import { registerServiceWorker } from "@/lib/service-worker";

/**
 * "3 waiting to send": photos kept on the phone for lack of signal, and taps not saved yet. Shows only while
 * something is waiting; it all goes by itself when the signal's back.
 */
export function OfflineBadge() {
  const real = useStore((s) => s.session.mode !== "demo");
  const photos = useUploadQueue((s) => s.waiting);
  const unsaved = useSyncStatus((s) => s.state === "offline");
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (!real) return;
    // Keeps a copy of the app on the phone, so it opens with no signal (built app only; lib/service-worker).
    void registerServiceWorker();
    void refreshCount().catch(() => {});
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [real]);
  const waiting = photos + (unsaved ? 1 : 0);
  if (!real || (!waiting && online)) return null;
  return (
    <span role="status" className="flex items-center gap-1.5 rounded-full bg-warn-soft px-3 py-1.5 text-xs font-medium text-[var(--accent-warn)]">
      <CloudOff className="h-3.5 w-3.5" />
      {waiting ? `${waiting} waiting to send` : "No signal"}
    </span>
  );
}
