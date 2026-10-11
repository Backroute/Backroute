"use client";

import Link from "next/link";
import { LoadStagePill } from "@/components/shared/load-stage";
import { ChevronRight } from "lucide-react";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LargeTitle } from "@/components/ui/large-title";
import { ViewTransition } from "react";
import { FORWARD } from "@/lib/nav-direction";
import { Lane } from "@/components/ui/lane";
import { usePayView } from "@/lib/pay-view";
import { usePagesText } from "@/lib/lang/pages-ui";

export default function DriverLoadsPage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const pay = usePayView();
  const p = usePagesText();

  const truck = trucks.find((t) => t.id === driver.truckId);
  // In a real account the office books loads with brokers; a company driver's app shows what's booked, not offers.
  const picksLoads = useStore((s) => s.session.mode !== "driver");
  // The choice itself lives on Home, where the trip is; here it's one line pointing there.
  const offerCount = loads.filter((l) => l.truckId === truck?.id && l.stage === "offered" && !!l.offerGroupId && picksLoads).length;
  const myLoads = [...loads.filter((l) => l.truckId === truck?.id && l.stage !== "offered")].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-5 px-5">
      <div>
        <LargeTitle className="font-display text-2xl text-ink-950">{p.loads.title}</LargeTitle>

        {offerCount > 0 && (
          <Link href="/driver#next-load" className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-ink-950 px-4 py-3 text-white">
            <span>
              <span className="block text-sm font-semibold">{p.loads.choose(offerCount)}</span>
              <span className="block text-xs text-white/60">{p.loads.chooseNote}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </Link>
        )}

        {myLoads.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-400">
            {offerCount > 0 ? p.loads.pickFirst : p.loads.none}
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {myLoads.map((load) => (
              <ViewTransition key={load.id} name={`load-${load.id}`} share="morph" default="none">
              <Link href={`/driver/loads/${load.id}`} transitionTypes={FORWARD} className="block rounded-2xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-ink-950">
                      <Lane from={load.lane.origin} to={load.lane.destination} />
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">{load.referenceNumber} · {formatDate(load.updatedAt)}</p>
                  </div>
                  <LoadStagePill stage={load.stage} label={p.stage[load.stage]} />
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                  <span>{load.lane.miles} mi</span>
                  <span>{load.equipmentType}</span>
                  <span>{load.weight.toLocaleString()} lbs</span>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-4 border-t border-line pt-2.5 text-xs">
                  <div className="flex items-center gap-4">
                    {pay.sees ? (
                      <>
                        <span className="text-ink-500">{p.loads.pays} <span className="font-semibold tabular text-ink-950">{formatCurrency(load.bookedRate ?? load.targetRate)}</span></span>
                        <span className="text-ink-500">{p.loads.yourPay} <span className="font-semibold tabular text-ink-950">{formatCurrency(load.netProfit ?? 0)}</span></span>
                      </>
                    ) : (
                      <span className="text-ink-500">{p.loads.yourPay} <span className="font-semibold tabular text-ink-950">{formatCurrency(pay.yourPay(load))}</span></span>
                    )}
                  </div>
                  {load.documents.length > 0 && (
                    <span className="text-ink-400">{p.loads.docs(load.documents.length)}</span>
                  )}
                </div>
              </Link>
              </ViewTransition>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
