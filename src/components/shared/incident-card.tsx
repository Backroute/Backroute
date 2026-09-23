"use client";

import { AlertTriangle, Check, CloudRain, Clock, LifeBuoy, UserRound, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/hooks";
import { timeAgo } from "@/lib/utils";
import { CompletionBar } from "./driver-trip-card";
import type { Incident, IncidentType } from "@/lib/types";

const TITLE: Record<IncidentType, string> = {
  breakdown: "Breakdown",
  accident: "Accident",
  delay: "Running late",
  weather: "Weather delay",
};
const ICON: Record<IncidentType, typeof Wrench> = { breakdown: Wrench, accident: AlertTriangle, delay: Clock, weather: CloudRain };

/** An incident the AI is working, as a live checklist: what it has already done (with the specifics), what it's on
 *  now, and the one step — if any — that's waiting on a person. */
export function IncidentCard({ incident, viewer, label, onApprove }: {
  incident: Incident;
  viewer: "driver" | "carrier";
  /** "T-102 · Marcus Bell" on the carrier's fleet view. */
  label?: string;
  /** Carrier only: approve the step that's waiting on them, right from the card. */
  onApprove?: () => void;
}) {
  const now = useNow();
  const Icon = ICON[incident.type];
  const done = incident.steps.filter((s) => s.status === "done").length;
  const current = incident.steps.find((s) => s.status === "pending");
  const waitingOnHuman = current?.owner === "human";
  const resolved = incident.status === "resolved";

  return (
    <section className="animate-rise-in overflow-hidden rounded-3xl bg-ink-950 p-5 text-white" aria-label={`${TITLE[incident.type]}, handled by the AI`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", resolved ? "bg-emerald-400/20 text-emerald-200" : "bg-red-500/20 text-red-200")}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
              {TITLE[incident.type]}{label ? ` · ${label}` : ""}
            </p>
            <p className="text-base font-semibold">
              {resolved ? "Handled. Back on plan." : waitingOnHuman ? (viewer === "carrier" ? "AI needs one OK from you" : "Waiting on your carrier's OK") : "AI is handling it"}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-white/40">{now ? timeAgo(incident.createdAt, now) : ""}</span>
      </div>

      <CompletionBar value={done / incident.steps.length} caption={`${done} of ${incident.steps.length} done${incident.humanNotified ? " · safety specialist on the line" : ""}`} />

      <ol className="mt-4 flex flex-col gap-3">
        {incident.steps.map((step, i) => {
          const isCurrent = step === current;
          return (
            <li key={i} className="flex gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  step.status === "done" ? "bg-white text-ink-950" : isCurrent ? "border-2 border-white" : "border border-white/25",
                  isCurrent && step.owner === "human" && "border-amber-300",
                )}
              >
                {step.status === "done" ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : isCurrent ? (
                  <span className={cn("h-1.5 w-1.5 animate-pulse-dot rounded-full", step.owner === "human" ? "bg-amber-300" : "bg-white")} />
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("flex items-center gap-1.5 text-sm font-medium", step.status === "pending" && !isCurrent && "text-white/45")}>
                  {step.label}
                  {step.owner === "human" && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                      <UserRound className="h-2.5 w-2.5" /> Human
                    </span>
                  )}
                </p>
                {step.detail && (step.status === "done" || isCurrent) && <p className="mt-0.5 text-xs text-white/55">{step.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {waitingOnHuman && viewer === "carrier" && onApprove && (
        <button type="button" onClick={onApprove} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-semibold text-ink-950">
          <Check className="h-4 w-4" /> {current?.label}
        </button>
      )}
      {!resolved && viewer === "driver" && (
        <p className="mt-4 flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-3 text-xs text-white/65">
          <LifeBuoy className="h-4 w-4 shrink-0" /> Stay with the truck. The AI will message you as each step lands.
        </p>
      )}
    </section>
  );
}
