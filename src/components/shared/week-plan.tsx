"use client";

import { BedDouble, Check, Home, Package, PackageOpen, Route, Sparkles, Truck } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { HOS, formatClock, type BlockKind, type PlanLeg, type WeekPlan } from "@/lib/planner";
import { Switch } from "@/components/ui/switch";

const BLOCK_ICON: Record<BlockKind, typeof Truck> = {
  deadhead: Route,
  drive: Truck,
  load: Package,
  unload: PackageOpen,
  rest: BedDouble,
  home: Home,
};

const KIND_LABEL: Record<PlanLeg["kind"], string> = { current: "On it now", booked: "Booked", planned: "AI will book" };

/** The AI's plan for the next few days: the loads, when the driver gets home, and every drive, dock and rest hour
 *  laid out inside hours-of-service limits. */
export function WeekPlanView({ plan, homeTarget, autoPick, onAutoPick }: {
  plan: WeekPlan;
  homeTarget?: string;
  autoPick: boolean;
  onAutoPick: (on: boolean) => void;
}) {
  const emptyPct = plan.loadedMiles + plan.emptyMiles ? (plan.emptyMiles / (plan.loadedMiles + plan.emptyMiles)) * 100 : 0;
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-3xl bg-ink-950 p-5 text-white">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
          <Sparkles className="h-3.5 w-3.5" /> Planned by AI · {plan.legs.filter((l) => l.kind !== "current").length} next {plan.legs.filter((l) => l.kind !== "current").length === 1 ? "load" : "loads"}
        </p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight">Home in {plan.homeCity} {plan.homeAt}</p>
        {plan.homeOnTime !== null && homeTarget && (
          <p className={cn("mt-1 flex items-center gap-1.5 text-xs", plan.homeOnTime ? "text-emerald-300" : "text-amber-200")}>
            {plan.homeOnTime ? <Check className="h-3.5 w-3.5" /> : null}
            {plan.homeOnTime
              ? `On time for your target: ${homeTarget.replace(/^Home/, "home")}`
              : `Can't make ${homeTarget.replace(/^Home/, "home")} with the loads already booked. The AI is asking the receiver for an earlier appointment.`}
          </p>
        )}
        {plan.trimmedFor && plan.homeOnTime !== false && (
          <p className="mt-1 text-xs text-white/60">
            {plan.trimmedFor === "home" ? "Planned a shorter week so you're home on time." : "Planned a shorter week to stay inside your 70 hours."}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Revenue" value={formatCurrency(plan.gross)} />
          <Tile label="Est. net" value={formatCurrency(plan.net)} />
          <Tile label="Loaded miles" value={plan.loadedMiles.toLocaleString()} />
          <Tile label="Empty miles" value={`${emptyPct.toFixed(0)}%`} />
        </div>
        <p className="mt-3 text-[11px] text-white/50">
          Uses {plan.onDutyHours} of {HOS.weekMax} on-duty hours · max {HOS.driveMax} h driving a day · 30-min break after {HOS.breakAfter} h · {HOS.reset}-h reset each night
        </p>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
          <div>
            <p className="text-sm font-medium">Let the AI book this plan</p>
            <p className="text-[11px] text-white/55">{autoPick ? "On: it books each next leg as it comes up." : "Off: you'll get the top 3 to choose from each time."}</p>
          </div>
          <Switch checked={autoPick} onChange={onAutoPick} label="Let the AI book this plan" dark />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-950">The loads</h2>
        <ol className="flex flex-col gap-2">
          {plan.legs.map((leg, i) => (
            <li key={`${leg.lane.origin}-${leg.lane.destination}-${i}`} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", leg.kind === "planned" ? "border border-dashed border-ink-300 text-ink-500" : "bg-ink-950 text-white")}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-950">
                  {leg.lane.origin} → {leg.lane.destination}
                </p>
                <p className="text-xs text-ink-500">
                  {KIND_LABEL[leg.kind]} · {leg.lane.miles} mi · {leg.deadheadMiles} empty · {leg.reason}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular text-ink-950">{formatCurrency(leg.rate)}</p>
                <p className="text-[11px] tabular text-ink-500">net {formatCurrency(leg.net)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-950">Day by day</h2>
        <div className="flex flex-col gap-3">
          {plan.days.map((day) => (
            <div key={day.index} className="rounded-2xl border border-line p-4">
              <p className="mb-2 text-sm font-semibold text-ink-950">{day.label}</p>
              <ol className="flex flex-col gap-2">
                {day.blocks.map((b, i) => {
                  const Icon = BLOCK_ICON[b.kind];
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-[4.5rem] shrink-0 pt-0.5 text-[11px] tabular text-ink-400">{formatClock(b.start)}</span>
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                          b.kind === "rest" ? "bg-blue-50 text-[var(--accent-info)]" : b.kind === "home" ? "bg-emerald-50 text-[var(--accent-live)]" : "bg-ink-100 text-ink-700",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-900">{b.label}</p>
                        <p className="text-xs text-ink-500">
                          {b.detail}
                          {b.hours > 0 ? `${b.detail ? " · " : ""}${b.hours.toFixed(1)} h` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/5 px-3 py-2.5">
      <p className="text-base font-semibold tabular">{value}</p>
      <p className="text-[11px] text-white/50">{label}</p>
    </div>
  );
}
