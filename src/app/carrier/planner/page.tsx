"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/portal-shell";
import { WeekPlanView } from "@/components/shared/week-plan";
import { useCarrierTrucks, useCarrierLoads, useDriverMap, truckActiveLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { planWeek } from "@/lib/planner";
import { cn, formatCurrency } from "@/lib/utils";

export default function CarrierPlannerPage() {
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const drivers = useDriverMap();
  const setAutoChain = useStore((s) => s.actions.setAutoChain);
  const now = useNow();
  const [truckId, setTruckId] = useState<string | null>(null);

  // Planned against the viewer's clock, so plans only render client-side.
  const plans =
    now === null
      ? []
      : trucks.map((truck) => {
          const driver = drivers.get(truck.driverId ?? "");
          const { current, next } = truckActiveLoads(loads, truck);
          return { truck, driver, plan: planWeek(truck, driver, current, next, new Date(now)) };
        });
  const selected = plans.find((p) => p.truck.id === truckId) ?? plans[0];

  return (
    <div>
      <PageHeader title="Planner" description="The AI's plan for every truck: next loads, hours of service, and when each driver gets home." />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar" role="tablist" aria-label="Trucks">
          {plans.map(({ truck, driver, plan }) => {
            const active = selected?.truck.id === truck.id;
            return (
              <button
                key={truck.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTruckId(truck.id)}
                className={cn(
                  "shrink-0 rounded-2xl border px-4 py-2.5 text-left transition-colors",
                  active ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-white text-ink-800 hover:border-ink-300",
                )}
              >
                <p className="text-sm font-semibold">{truck.unitNumber} · {driver?.name.split(" ")[0] ?? "Unassigned"}</p>
                <p className={cn("text-[11px]", active ? "text-white/60" : "text-ink-500")}>
                  Home {plan.homeAt} · net {formatCurrency(plan.net)}
                </p>
              </button>
            );
          })}
        </div>
        {selected ? (
          <div className="max-w-2xl">
            <WeekPlanView
              plan={selected.plan}
              homeTarget={selected.driver && selected.driver.homeTimeTarget !== "No preference set" ? selected.driver.homeTimeTarget : undefined}
              autoPick={!!selected.truck.autoChainNextLoad}
              onAutoPick={(on) => setAutoChain(selected.truck.id, on)}
            />
          </div>
        ) : (
          <p className="text-sm text-ink-500">Planning…</p>
        )}
      </div>
    </div>
  );
}
