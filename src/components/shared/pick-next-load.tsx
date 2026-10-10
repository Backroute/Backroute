"use client";

import { useMemo } from "react";
import { Sheet } from "@/components/ui/sheet";
import { NextLoadOffers } from "./next-load-offers";
import { useStore } from "@/lib/store";
import { useBrokerMap, useCarrierLoads, useDriverMap, useTruckMap } from "@/lib/selectors";
import { offerOptions } from "@/lib/plans";
import type { Load } from "@/lib/types";

/** A truck's waiting choices, one group per offer round. */
export function useTruckOffers(truckId: string | null | undefined): [string, Load[]][] {
  const loads = useCarrierLoads();
  return useMemo(() => {
    if (!truckId) return [];
    const map = new Map<string, Load[]>();
    for (const l of loads) if (l.truckId === truckId && l.stage === "offered" && l.offerGroupId) map.set(l.offerGroupId, [...(map.get(l.offerGroupId) ?? []), l]);
    return [...map.entries()];
  }, [loads, truckId]);
}

/** How many choices (a plan of several loads is one) a truck has waiting. */
export const choiceCount = (groups: [string, Load[]][]) => groups.reduce((n, [, g]) => n + offerOptions(g).length, 0);

/**
 * Picking a truck's next load, wherever the owner is: the card that says it's waiting opens the choices right over it,
 * instead of sending them down the page or to another tab. Closes once one is picked.
 */
export function PickNextLoad({ truckId, open, onClose }: { truckId: string | null; open: boolean; onClose: () => void }) {
  const groups = useTruckOffers(truckId);
  const brokers = useBrokerMap();
  const trucks = useTruckMap();
  const drivers = useDriverMap();
  const selectLoadOffer = useStore((s) => s.actions.selectLoadOffer);
  const requestOfferDetail = useStore((s) => s.actions.requestOfferDetail);
  const resolveOfferDetail = useStore((s) => s.actions.resolveOfferDetail);
  const truck = truckId ? trucks.get(truckId) : undefined;
  const driver = truck?.driverId ? drivers.get(truck.driverId) : undefined;
  return (
    <Sheet open={open && groups.length > 0} onClose={onClose} title={`${driver ? `${driver.name.split(" ")[0]}'s` : truck?.unitNumber ?? "The"} next load`} size="lg">
      <NextLoadOffers
        offerGroups={groups}
        brokers={brokers}
        trucks={trucks}
        drivers={drivers}
        onSelect={(groupId, loadId, also) => {
          selectLoadOffer(groupId, loadId, "carrier", also);
          onClose();
        }}
        onAsk={(loadId, text) => requestOfferDetail(loadId, text)}
        onAskResolve={(loadId, draft) => resolveOfferDetail(loadId, draft)}
      />
    </Sheet>
  );
}
