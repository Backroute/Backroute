"use client";

import { CheckCircle2, FileCheck2, MapPin, Truck } from "lucide-react";
import type { TrackView } from "@/lib/track-view";
import { cn } from "@/lib/utils";

const STEPS: TrackView["step"][] = ["booked", "to_pickup", "at_pickup", "in_transit", "at_delivery", "delivered"];
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);

/** One load as its broker or shipper sees it: where it is (to the town), when it should arrive, and its steps. */
export function TrackPanel({ view, compact }: { view: TrackView; compact?: boolean }) {
  const reached = STEPS.indexOf(view.step);
  return (
    <div className={cn("rounded-3xl border border-line bg-white", compact ? "p-4" : "p-5 sm:p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-400">Load {view.ref}</p>
          <p className="mt-1 text-lg font-semibold text-ink-950">
            {view.origin} → {view.destination}
          </p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", view.step === "delivered" ? "bg-ink-950 text-white" : view.step === "cancelled" ? "bg-ink-100 text-ink-600" : "bg-ink-100 text-ink-900")}>
          {view.status}
        </span>
      </div>

      {view.step !== "cancelled" && (
        <ol className="mt-4 grid grid-cols-6 gap-1" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("h-1.5 rounded-full", i <= reached ? "bg-ink-950" : "bg-ink-100")} />
          ))}
        </ol>
      )}

      <dl className="mt-4 flex flex-col gap-2.5 text-sm">
        {view.where && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <div>
              <dt className="sr-only">Where</dt>
              <dd className="font-medium text-ink-950">{view.where}</dd>
              {view.whereAt && <dd className="text-xs text-ink-500">as of {at(view.whereAt)}</dd>}
            </div>
          </div>
        )}
        {view.eta && (
          <div className="flex items-start gap-2">
            <Truck className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <div>
              <dt className="text-xs text-ink-500">Estimated arrival</dt>
              <dd className="font-medium text-ink-950">{at(view.eta)}</dd>
            </div>
          </div>
        )}
        {view.deliveredAt && (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <div>
              <dt className="text-xs text-ink-500">Delivered</dt>
              <dd className="font-medium text-ink-950">{at(view.deliveredAt)}</dd>
            </div>
          </div>
        )}
        {view.podReceived && (
          <div className="flex items-start gap-2">
            <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <dd className="font-medium text-ink-950">Signed proof of delivery received</dd>
          </div>
        )}
        {!compact && (view.pickupAt || view.deliveryAt) && (
          <div className="mt-1 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
            <div>
              <dt className="text-ink-500">Pickup appointment</dt>
              <dd className="font-medium text-ink-900">{at(view.pickupAt) ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Delivery appointment</dt>
              <dd className="font-medium text-ink-900">{at(view.deliveryAt) ?? "—"}</dd>
            </div>
          </div>
        )}
      </dl>
    </div>
  );
}
