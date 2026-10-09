"use client";

import { Bot, Building2, Check, Truck, UserRound } from "lucide-react";
import { useEffect } from "react";
import { useMounted } from "@/lib/hooks";
import { markSample } from "@/components/cloud/sample-fleet";
import { formatAtStop } from "@/lib/stop-time";
import type { Load } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

type Who = "ai" | "you" | "driver" | "broker";

interface Step {
  key: string;
  title: string;
  at?: string;
  /** For a stop's own events: the state, so the time reads in the dock's zone. */
  zone?: string;
  who?: Who;
  whoLabel?: string;
  detail?: string;
}

const WHO_ICON = { ai: Bot, you: UserRound, driver: Truck, broker: Building2 } as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const ownerAdded = (l: Load) => /manual|by hand|you added|rate con upload|added/i.test(l.source);

/** The load's life in order, from the offer to the money in the bank: what happened, when, and who did it. */
function stepsOf(load: Load, names: { broker?: string; driver?: string }): { steps: Step[]; ended?: string } {
  const broker = names.broker ?? "Broker";
  const driver = names.driver ?? "Driver";
  const req = load.bookRequest;
  const rounds = req?.history?.length ?? 0;
  const rateCon = load.documents.find((d) => d.type === "rate_confirmation");
  const pod = load.documents.find((d) => d.type === "pod");
  const booked = !["sourced", "scoring", "offered", "negotiating", "declined"].includes(load.stage);
  const delivered = load.stage === "delivered";
  const pickedUp = !!load.tripChecklist?.loadedAt || ["in_transit", "at_delivery", "delivered"].includes(load.stage);

  const steps: Step[] = [
    {
      key: "offer",
      title: "Offer came in",
      at: load.createdAt,
      who: ownerAdded(load) ? "you" : "broker",
      whoLabel: ownerAdded(load) ? "You added it" : load.source,
      detail: `${load.lane.origin}, ${load.lane.originState} → ${load.lane.destination}, ${load.lane.destState}${load.listedRate ? ` · posted ${formatCurrency(load.listedRate)}` : ""}`,
    },
    {
      key: "ask",
      title: req?.byOwner ? "You asked to book it" : "Backroute asked to book it",
      at: req?.askedAt,
      who: req ? (req.byOwner ? "you" : "ai") : undefined,
      whoLabel: req ? (req.byOwner ? "You" : "Backroute") : undefined,
      detail: req
        ? `Asked ${formatCurrency(req.opening ?? req.ask)}${rounds > 1 ? ` · ${rounds} offers back and forth` : ""}${req.brokerOffer ? ` · ${broker} came back at ${formatCurrency(req.brokerOffer)}` : ""}`
        : undefined,
    },
    {
      key: "booked",
      title: "Booked",
      at: booked ? (rateCon?.generatedAt ?? load.updatedAt) : undefined,
      who: booked ? "broker" : undefined,
      whoLabel: booked ? `${broker} confirmed` : undefined,
      detail: booked && load.bookedRate ? `${formatCurrency(load.bookedRate)} all in` : undefined,
    },
    {
      key: "ratecon",
      title: load.rateConSignedAt ? "Rate con signed" : "Rate con in",
      at: load.rateConSignedAt ?? rateCon?.generatedAt,
      who: load.rateConSignedAt ? "ai" : rateCon ? "broker" : undefined,
      whoLabel: load.rateConSignedAt ? `Signed as ${load.rateConSignedBy ?? "the carrier"}` : rateCon ? broker : undefined,
      detail: rateCon ? (rateCon.flagged ? "Backroute found something to check on it" : "Checked against what was agreed") : undefined,
    },
    {
      key: "pickup",
      title: "Picked up",
      zone: load.lane.originState,
      at: load.tripChecklist?.loadedAt ?? (pickedUp ? (load.tripChecklist?.arrivedPickupAt ?? load.pickupAt) : undefined),
      who: pickedUp ? "driver" : undefined,
      whoLabel: pickedUp ? driver : undefined,
      detail: load.tripChecklist?.sealNumber ? `Seal ${load.tripChecklist.sealNumber}` : undefined,
    },
    {
      key: "delivered",
      title: "Delivered",
      zone: load.lane.destState,
      at: delivered ? (load.tripChecklist?.unloadedAt ?? load.deliveryAt ?? load.updatedAt) : undefined,
      who: delivered ? "driver" : undefined,
      whoLabel: delivered ? driver : undefined,
      detail: delivered ? (pod ? "Proof of delivery in" : "Waiting on the proof of delivery") : undefined,
    },
    {
      key: "invoiced",
      title: "Invoiced",
      at: load.invoice?.sentAt,
      who: load.invoice?.sentAt ? "ai" : undefined,
      whoLabel: load.invoice?.sentAt ? "Backroute" : undefined,
      detail: load.invoice ? `${formatCurrency(load.invoice.amount)}${load.invoice.sentTo ? ` to ${load.invoice.sentTo}` : ""}${load.invoice.remindedAt?.length ? ` · reminded ${load.invoice.remindedAt.length}×` : ""}` : undefined,
    },
    {
      key: "paid",
      title: "Paid",
      at: load.invoice?.paidAt,
      who: load.invoice?.paidAt ? "broker" : undefined,
      whoLabel: load.invoice?.paidAt ? broker : undefined,
      detail: load.invoice?.paidAt
        ? load.invoice.paidAmount !== undefined && load.invoice.paidAmount < load.invoice.amount
          ? `${formatCurrency(load.invoice.paidAmount)}, ${formatCurrency(load.invoice.amount - load.invoice.paidAmount)} short`
          : formatCurrency(load.invoice.paidAmount ?? load.invoice.amount)
        : undefined,
    },
  ];
  const ended = load.stage === "declined" ? (req?.passedAt ? "Let go: the broker wouldn't come up to your lowest." : "Let go: it didn't work out with the broker.") : undefined;
  return { steps, ended };
}

export function LoadTimeline({ load, brokerName, driverName, className }: { load: Load; brokerName?: string; driverName?: string; className?: string }) {
  const { steps, ended } = stepsOf(load, { broker: brokerName, driver: driverName });
  // Times show once the page is running in the browser, in the viewer's own time zone.
  const live = useMounted();
  useEffect(() => markSample("timeline"), []);
  const current = ended ? -1 : steps.findIndex((s) => !s.at);
  return (
    <section aria-labelledby={`timeline-${load.id}`} className={cn("rounded-2xl border border-line bg-white p-5", className)}>
      <h3 id={`timeline-${load.id}`} className="t-section text-ink-950">
        Timeline
      </h3>
      <p className="mt-0.5 text-xs text-ink-500">Every step of this load, who did it, and when.</p>
      <ol className="mt-4">
        {steps.map((s, i) => {
          const done = !!s.at;
          const isNow = i === current;
          const Icon = s.who ? WHO_ICON[s.who] : null;
          return (
            <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
              {i < steps.length - 1 && (
                <span aria-hidden className={cn("absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px", done && steps[i + 1]?.at ? "bg-ink-300" : "bg-line")} />
              )}
              <span
                className={cn(
                  "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                  done ? "border-ink-950 bg-ink-950 text-white" : isNow ? "border-ink-950 bg-white text-ink-950" : "border-line bg-white text-ink-300",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : <span className={cn("h-1.5 w-1.5 rounded-full", isNow ? "animate-pulse bg-ink-950" : "bg-ink-300")} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className={cn("text-sm font-medium", done ? "text-ink-950" : isNow ? "text-ink-800" : "text-ink-400")}>
                    {s.title}
                    {isNow && <span className="ml-2 text-xs font-normal text-ink-500">next</span>}
                  </p>
                  {s.at && live && <p className="text-xs tabular text-ink-500">{s.zone ? formatAtStop(s.at, s.zone) : when(s.at)}</p>}
                </div>
                {(s.whoLabel || s.detail) && (
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-600">
                    {Icon && s.whoLabel && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-700">
                        <Icon className="h-3 w-3" /> {s.whoLabel}
                      </span>
                    )}
                    {s.detail && <span>{s.detail}</span>}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {ended && <p className="mt-4 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600">{ended}</p>}
    </section>
  );
}
