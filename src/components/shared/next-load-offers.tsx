"use client";

import { Sparkles } from "lucide-react";
import { LoadOfferCard } from "./load-offer-card";
import { TruckDriverChip } from "./truck-driver-chip";
import type { OfferAskDraft } from "@/lib/engine";
import type { Broker, Driver, Load, Truck } from "@/lib/types";

/** Shared "choose your next load" picker — used at the top of both the carrier Overview and driver Home, so it looks identical in both apps. */
export function NextLoadOffers({
  offerGroups,
  brokers,
  trucks,
  drivers,
  onSelect,
  onAsk,
  onAskResolve,
}: {
  offerGroups: [string, Load[]][];
  brokers: Map<string, Broker>;
  /** Pass when a single view can span multiple trucks (carrier) to label each group — omit for a single-truck context (driver). */
  trucks?: Map<string, Truck>;
  drivers?: Map<string, Driver>;
  onSelect: (groupId: string, loadId: string) => void;
  onAsk: (loadId: string, text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
  onAskResolve: (loadId: string, draft: OfferAskDraft) => string;
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
        AI checked every connected board and scored {totalCount} option{totalCount === 1 ? "" : "s"} for you. Its pick weighs pay per hour, how far each
        load leaves the driver from home, and whether there&apos;s freight to reload after.
      </p>
      <div className="flex flex-col gap-6">
        {offerGroups.map(([groupId, groupLoads]) => {
          // The AI pick leads: it can beat a higher score once home time and the next reload are counted.
          const loads = [...groupLoads].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || b.score - a.score);
          const truck = trucks && loads[0].truckId ? trucks.get(loads[0].truckId) : undefined;
          const driver = drivers && truck?.driverId ? drivers.get(truck.driverId) : undefined;
          return (
            <div key={groupId}>
              {trucks && (
                <TruckDriverChip
                  truck={truck}
                  driver={driver}
                  trailing={<span className="ml-auto shrink-0 text-[11px] text-ink-400">{loads.length} option{loads.length === 1 ? "" : "s"}</span>}
                  className="mb-2.5"
                />
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                {loads.map((load) => (
                  <LoadOfferCard
                    key={load.id}
                    load={load}
                    broker={brokers.get(load.brokerId)}
                    truck={truck}
                    driver={driver}
                    onSelect={() => onSelect(groupId, load.id)}
                    onAsk={(text) => onAsk(load.id, text)}
                    onAskResolve={(draft) => onAskResolve(load.id, draft)}
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
