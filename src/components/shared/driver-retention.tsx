"use client";

import { CalendarClock, Check, Clock, DollarSign, Home, MessageCircle, Phone, Timer } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { useCarrierLoads, truckActiveLoads } from "@/lib/selectors";
import { planWeek } from "@/lib/planner";
import { retentionFor, type RetentionView, type SignalKind } from "@/lib/retention";
import { formatCurrency } from "@/lib/utils";
import type { Driver } from "@/lib/types";

const SIGNAL_ICON: Record<SignalKind, typeof Home> = {
  home: Home, pay: DollarSign, dock: Timer, owed: DollarSign, time_off: CalendarClock, hours: Clock, contact: MessageCircle,
};

/** Every driver's warning signs, worst first. Plans against the viewer's clock, so it's empty until mounted. */
export function useDriverRetention(): { driver: Driver; view: RetentionView }[] {
  const now = useNow();
  const drivers = useStore((s) => s.drivers);
  const trucks = useStore((s) => s.trucks);
  const expenses = useStore((s) => s.expenses);
  const timeOff = useStore((s) => s.timeOffRequests);
  const loads = useCarrierLoads();
  if (now === null) return [];
  const rank = { at_risk: 0, watch: 1, good: 2 };
  return drivers
    .map((driver) => {
      const truck = trucks.find((t) => t.driverId === driver.id || t.secondDriverId === driver.id);
      const { current, next } = truckActiveLoads(loads, truck);
      const plan = truck ? planWeek(truck, driver, current, next, new Date(now)) : null;
      return { driver, view: retentionFor(driver, expenses, timeOff, plan?.homeOnTime ?? null, now) };
    })
    .sort((a, b) => rank[a.view.level] - rank[b.view.level]);
}

export function DriverCheckInCard({ driver, view }: { driver: Driver; view: RetentionView }) {
  const respondExpense = useStore((s) => s.actions.respondExpense);
  const logDriverCheckIn = useStore((s) => s.actions.logDriverCheckIn);
  const setHomePriority = useStore((s) => s.actions.setHomePriority);
  const first = driver.name.split(" ")[0];
  const owed = view.pendingExpenses.reduce((s, e) => s + e.amount, 0);
  const homeSignal = view.signals.some((s) => s.kind === "home");

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={driver.name} size="sm" />
          <div>
            <p className="text-sm font-semibold text-ink-950">{driver.name}</p>
            <p className="text-xs text-ink-500">Talked {view.daysSinceCheckIn === 0 ? "today" : `${view.daysSinceCheckIn} day${view.daysSinceCheckIn === 1 ? "" : "s"} ago`}</p>
          </div>
        </div>
        <Badge tone={view.level === "at_risk" ? "danger" : view.level === "watch" ? "warning" : "success"}>
          {view.level === "at_risk" ? "Needs you this week" : view.level === "watch" ? "Keep an eye on" : "Doing fine"}
        </Badge>
      </div>

      {view.signals.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {view.signals.map((s) => {
            const Icon = SIGNAL_ICON[s.kind];
            return (
              <li key={s.text} className="flex gap-2 text-xs text-ink-700">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" /> {s.text}
              </li>
            );
          })}
        </ul>
      )}

      {homeSignal && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
          <div>
            <p className="text-xs font-medium text-ink-900">Get {first} home first</p>
            <p className="text-[11px] text-ink-500">The AI picks loads that deliver near home, even at a lower rate.</p>
          </div>
          <Switch checked={!!driver.homePriority} onChange={(on) => setHomePriority(driver.id, on)} label={`Get ${first} home first`} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {owed > 0 && (
          <Button size="sm" variant="primary" onClick={() => view.pendingExpenses.forEach((e) => respondExpense(e.id, true))}>
            <Check className="h-3.5 w-3.5" /> Pay back {formatCurrency(owed)}
          </Button>
        )}
        {view.pendingTimeOff && (
          <Button size="sm" variant="outline" href="/carrier#needs-you">
            <CalendarClock className="h-3.5 w-3.5" /> Answer time off
          </Button>
        )}
        <Button size="sm" variant="outline" href={`tel:${driver.phone.replace(/[^\d]/g, "")}`}>
          <Phone className="h-3.5 w-3.5" /> Call {first}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => logDriverCheckIn(driver.id)}>
          Log that you talked
        </Button>
      </div>
    </div>
  );
}
