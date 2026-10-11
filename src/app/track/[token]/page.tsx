"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { TrackPanel } from "@/components/shared/track-panel";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { trackView, type TrackView } from "@/lib/track-view";

/**
 * The page a broker or shipper opens from a tracking link: no app, no sign-in. It refreshes every minute. A sample
 * account's link ("demo-…") shows the sample load from this browser instead.
 */
export default function TrackPage() {
  const { token } = useParams<{ token: string }>();
  const demoId = token.startsWith("demo-") ? token.slice(5) : null;
  const loads = useStore((s) => s.loads);
  const trucks = useStore((s) => s.trucks);
  const carriers = useStore((s) => s.carriers);
  const now = useNow();
  const demoLoad = demoId ? loads.find((l) => l.id === demoId) : undefined;
  const demo = demoLoad ? { load: demoLoad, truck: trucks.find((t) => t.id === demoLoad.truckId), carrier: carriers.find((c) => c.id === demoLoad.carrierId)?.name ?? "Sample carrier" } : null;
  const [view, setView] = useState<TrackView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "gone">("loading");
  // The carrier's MC, so the receiver or shipper can check who's hauling it.
  const [mc, setMc] = useState<string | null>(null);

  useEffect(() => {
    if (demoId) return;
    let stop = false;
    const read = async () => {
      const res = await fetch(`/api/track?t=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (res?.ok) {
        const body = (await res.json()) as TrackView & { mc?: string | null };
        setView(body);
        setMc(body.mc ?? null);
        setState("ok");
      } else if (res && res.status !== 429) setState("gone");
    };
    void read();
    const id = setInterval(() => void read(), 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [demoId, token]);

  const shown = demo && now !== null ? trackView(demo.load, demo.truck, demo.carrier, now) : view;
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10">
      {shown ? (
        <>
          <p className="text-sm text-ink-500">
            Tracking from <span className="font-medium text-ink-900">{shown.carrier}</span>
            {mc && !demo && ` · ${/^mc/i.test(mc) ? mc : `MC ${mc}`}`}
            {demo && " · sample"}
          </p>
          <TrackPanel view={shown} />
          <p className="text-xs text-ink-400">Where the truck is shows to the nearest town. This page updates by itself.</p>
        </>
      ) : state === "loading" && !demoId ? (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        <p className="text-sm text-ink-600">This tracking link has expired or the load isn&apos;t available. Ask the carrier for a new one.</p>
      )}
    </main>
  );
}
