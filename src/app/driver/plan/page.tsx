"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WeekPlanView } from "@/components/shared/week-plan";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, truckActiveLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { planWeek } from "@/lib/planner";

export default function DriverPlanPage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const setAutoChain = useStore((s) => s.actions.setAutoChain);
  const now = useNow();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const { current, next } = truckActiveLoads(loads, truck);
  // Planned against the viewer's clock, so it only renders client-side.
  const plan = truck && now !== null ? planWeek(truck, driver, current, next, new Date(now)) : null;

  return (
    <div className="flex flex-col gap-5 px-5">
      <Link href="/driver" className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
        <ArrowLeft className="h-3.5 w-3.5" /> Home
      </Link>
      <div>
        <h1 className="font-display text-2xl text-ink-950">Your next few days</h1>
        <p className="mt-1 text-sm text-ink-500">The AI lines up your loads around your hours and gets you home.</p>
      </div>
      {plan && truck ? (
        <WeekPlanView
          plan={plan}
          homeTarget={driver.homeTimeTarget !== "No preference set" ? driver.homeTimeTarget : undefined}
          autoPick={!!truck.autoChainNextLoad}
          onAutoPick={(on) => setAutoChain(truck.id, on)}
        />
      ) : (
        <p className="rounded-2xl border border-line px-4 py-6 text-center text-sm text-ink-500">Planning your week…</p>
      )}
    </div>
  );
}
