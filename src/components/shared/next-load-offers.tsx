"use client";

import { LoadOfferCard } from "./load-offer-card";
import { OfferRail } from "./offer-rail";
import { emailedPairs, emailedTrips, offerOptions } from "@/lib/plans";
import { crewOf, type Crew } from "@/lib/hos-plan";
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
  crew,
}: {
  offerGroups: [string, Load[]][];
  brokers: Map<string, Broker>;
  /** Pass when a single view can span multiple trucks (carrier) to label each group — omit for a single-truck context (driver). */
  trucks?: Map<string, Truck>;
  drivers?: Map<string, Driver>;
  /** `also`: the other loads of a plan put together from a real account's emailed loads, booked with it. */
  onSelect: (groupId: string, loadId: string, also?: string[]) => void;
  onAsk: (loadId: string, text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
  onAskResolve: (loadId: string, draft: OfferAskDraft) => string;
  /** The driver's phone: let the row of cards run to the screen edges. */
  bleed?: boolean;
  /** The driver's own truck (driver app): team or solo, and their hours left. The owner's view works it out per truck. */
  crew?: Crew;
}) {
  // A real account's offers are loads brokers emailed; there's no load board behind them, and questions go by email.
  const real = useStore((s) => s.session.mode !== "demo");
  if (offerGroups.length === 0) return null;
  // Choices, not loads: a plan of three loads is one choice.
  const totalCount = offerGroups.reduce((sum, [, loads]) => sum + offerOptions(loads).length, 0);

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
          // Each choice is a load or a plan of several. The best fit leads: it can beat a higher score once home time,
          // the next reload and the empty miles between loads are counted.
          // A real account's emailed loads that chain, or partials that share the trailer, also show as one plan,
          // next to the singles.
          const options = real ? [...offerOptions(groupLoads), ...emailedPairs(groupLoads), ...emailedTrips(groupLoads)] : offerOptions(groupLoads);
          const loads = options.map((o) => o[0]);
          const truck = trucks && loads[0].truckId ? trucks.get(loads[0].truckId) : undefined;
          const driver = drivers && truck?.driverId ? drivers.get(truck.driverId) : undefined;
          return (
            <div key={groupId}>
              <OfferRail bleed={bleed} header={trucks ? <TruckDriverChip truck={truck} driver={driver} /> : undefined}>
                {options.map(([load, ...rest]) => (
                  <LoadOfferCard
                    key={load.plan?.id ?? load.id}
                    load={load}
                    legs={[load, ...rest]}
                    broker={brokers.get(load.brokerId)}
                    brokers={brokers}
                    crew={crew ?? (truck ? crewOf(truck, driver) : undefined)}
                    viewer={trucks ? "owner" : "driver"}
                    onSelect={() => onSelect(groupId, load.id, real && rest.length ? rest.map((l) => l.id) : undefined)}
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
