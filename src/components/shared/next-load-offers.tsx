"use client";

import { LoadOfferCard } from "./load-offer-card";
import { OfferRail } from "./offer-rail";
import { TruckDriverChip } from "./truck-driver-chip";
import type { OfferAskDraft } from "@/lib/engine";
import { useStore } from "@/lib/store";
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
  bleed,
}: {
  offerGroups: [string, Load[]][];
  brokers: Map<string, Broker>;
  /** Pass when a single view can span multiple trucks (carrier) to label each group — omit for a single-truck context (driver). */
  trucks?: Map<string, Truck>;
  drivers?: Map<string, Driver>;
  onSelect: (groupId: string, loadId: string) => void;
  onAsk: (loadId: string, text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
  onAskResolve: (loadId: string, draft: OfferAskDraft) => string;
  /** The driver's phone: let the row of cards run to the screen edges. */
  bleed?: boolean;
}) {
  // A real account's offers are loads brokers emailed; there's no load board behind them, and questions go by email.
  const real = useStore((s) => s.session.mode !== "demo");
  if (offerGroups.length === 0) return null;
  const totalCount = offerGroups.reduce((sum, [, loads]) => sum + loads.length, 0);

  return (
    <div>
      <h2 className="mb-1 text-[17px] font-semibold tracking-tight text-ink-950">Choose your next load</h2>
      {real ? (
        <p className="mb-3 text-xs text-ink-500">
          {totalCount} load{totalCount === 1 ? "" : "s"} brokers emailed you fit{totalCount === 1 ? "s" : ""} a truck. Pick one and Backroute emails the broker to book it
          at the price shown, never under your lowest rate. It&apos;s booked when their rate con comes back and matches.
        </p>
      ) : (
        <p className="mb-3 text-xs text-ink-500">
          {totalCount} option{totalCount === 1 ? "" : "s"} from every connected board. Best fit weighs pay per hour, home time and the next reload.
        </p>
      )}
      <div className="flex flex-col gap-6">
        {offerGroups.map(([groupId, groupLoads]) => {
          // The best fit leads: it can beat a higher score once home time and the next reload are counted.
          const loads = [...groupLoads].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || b.score - a.score);
          const truck = trucks && loads[0].truckId ? trucks.get(loads[0].truckId) : undefined;
          const driver = drivers && truck?.driverId ? drivers.get(truck.driverId) : undefined;
          return (
            <div key={groupId}>
              <OfferRail bleed={bleed} header={trucks ? <TruckDriverChip truck={truck} driver={driver} /> : undefined}>
                {loads.map((load) => (
                  <LoadOfferCard
                    key={load.id}
                    load={load}
                    broker={brokers.get(load.brokerId)}
                    viewer={trucks ? "owner" : "driver"}
                    onSelect={() => onSelect(groupId, load.id)}
                    onAsk={real ? undefined : (text) => onAsk(load.id, text)}
                    onAskResolve={real ? undefined : (draft) => onAskResolve(load.id, draft)}
                  />
                ))}
              </OfferRail>
            </div>
          );
        })}
      </div>
    </div>
  );
}
