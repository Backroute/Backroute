"use client";

import { Sparkles } from "lucide-react";
import { LoadStagePill } from "@/components/shared/load-stage";
import { LoadOfferCard } from "@/components/shared/load-offer-card";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, useBrokerMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function DriverLoadsPage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const selectLoadOffer = useStore((s) => s.actions.selectLoadOffer);
  const requestOfferDetail = useStore((s) => s.actions.requestOfferDetail);
  const resolveOfferDetail = useStore((s) => s.actions.resolveOfferDetail);

  const truck = trucks.find((t) => t.id === driver.truckId);
  const pendingOffers = loads.filter((l) => l.truckId === truck?.id && l.stage === "offered").sort((a, b) => b.score - a.score);
  const myLoads = [...loads.filter((l) => l.truckId === truck?.id && l.stage !== "offered")].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-5 px-5">
      {pendingOffers.length > 0 && (
        <div>
          <div className="mb-2.5 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-ink-950" />
            <p className="text-sm font-semibold text-ink-950">Choose your next load</p>
          </div>
          <p className="mb-3 text-xs text-ink-500">
            AI checked every connected board and scored {pendingOffers.length} options for you.
          </p>
          <div className="flex flex-col gap-3">
            {pendingOffers.map((offer) => (
              <LoadOfferCard
                key={offer.id}
                load={offer}
                broker={brokers.get(offer.brokerId)}
                compact
                onSelect={() => offer.offerGroupId && selectLoadOffer(offer.offerGroupId, offer.id, "driver")}
                onAsk={(text) => requestOfferDetail(offer.id, text)}
                onAskResolve={(draft) => resolveOfferDetail(offer.id, draft)}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h1 className="font-display text-2xl text-ink-950">Your loads</h1>

        {myLoads.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-400">
            {pendingOffers.length > 0 ? "Pick a load above to get started." : "No loads assigned yet."}
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {myLoads.map((load) => (
              <div key={load.id} className="rounded-2xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-ink-950">
                      {load.lane.origin} <span className="text-ink-300">→</span> {load.lane.destination}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">{load.referenceNumber} · {formatDate(load.updatedAt)}</p>
                  </div>
                  <LoadStagePill stage={load.stage} />
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                  <span>{load.lane.miles} mi</span>
                  <span>{load.equipmentType}</span>
                  <span>{load.weight.toLocaleString()} lbs</span>
                </div>
                <div className="mt-2.5 flex items-center gap-4 border-t border-line pt-2.5 text-xs">
                  <span className="text-ink-500">Total offer <span className="font-semibold tabular text-ink-950">{formatCurrency(load.bookedRate ?? load.targetRate)}</span></span>
                  <span className="text-ink-500">Est. net <span className="font-semibold tabular text-ink-950">{formatCurrency(load.netProfit ?? 0)}</span></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
