"use client";

import { LoadStagePill } from "@/components/shared/load-stage";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads } from "@/lib/selectors";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function DriverLoadsPage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const myLoads = [...loads.filter((l) => l.truckId === truck?.id)].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-4 px-5">
      <h1 className="font-display text-2xl text-ink-950">Your loads</h1>

      {myLoads.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-400">No loads assigned yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
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
  );
}
