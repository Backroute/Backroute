"use client";

import { Sparkles } from "lucide-react";
import { LoadOfferCard } from "./load-offer-card";
import type { Broker, Load, Truck } from "@/lib/types";

/** Shared "choose your next load" picker — used at the top of both the carrier Overview and driver Home, so it looks identical in both apps. */
export function NextLoadOffers({
  offerGroups,
  brokers,
  trucks,
  onSelect,
  onNegotiate,
}: {
  offerGroups: [string, Load[]][];
  brokers: Map<string, Broker>;
  /** Pass when a single view can span multiple trucks (carrier) to label each group — omit for a single-truck context (driver). */
  trucks?: Map<string, Truck>;
  onSelect: (groupId: string, loadId: string) => void;
  onNegotiate: (loadId: string) => void;
}) {
  if (offerGroups.length === 0) return null;
  const totalCount = offerGroups.reduce((sum, [, loads]) => sum + loads.length, 0);

  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-ink-950" />
        <p className="text-sm font-semibold text-ink-950">Choose your next load</p>
      </div>
      <p className="mb-3 text-xs text-ink-500">
        AI checked every connected board and scored {totalCount} option{totalCount === 1 ? "" : "s"} for you.
      </p>
      <div className="flex flex-col gap-6">
        {offerGroups.map(([groupId, loads]) => {
          const truck = trucks && loads[0].truckId ? trucks.get(loads[0].truckId) : undefined;
          return (
            <div key={groupId}>
              {trucks && (
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
                  {truck ? `${truck.unitNumber} — awaiting choice` : "Awaiting choice"}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                {loads.map((load) => (
                  <LoadOfferCard
                    key={load.id}
                    load={load}
                    broker={brokers.get(load.brokerId)}
                    onSelect={() => onSelect(groupId, load.id)}
                    onNegotiate={() => onNegotiate(load.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
