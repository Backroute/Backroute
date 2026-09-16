"use client";

import Link from "next/link";
import { ArrowUpRight, Link2, MapPin, MessageCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { LoadStagePill } from "@/components/shared/load-stage";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads } from "@/lib/selectors";
import { formatNumber } from "@/lib/utils";

export default function DriverHomePage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const currentLoad = loads.find((l) => l.id === truck?.currentLoadId);
  const nextLoad = loads.find((l) => l.id === truck?.nextLoadId);

  const weekLoads = loads.filter((l) => l.truckId === truck?.id);
  const weekMiles = weekLoads.reduce((s, l) => s + l.lane.miles, 0);

  return (
    <div className="flex flex-col gap-5 px-5">
      <div>
        <p className="text-sm text-ink-500">Welcome back,</p>
        <h1 className="font-display text-2xl text-ink-950">{driver.name.split(" ")[0]}</h1>
      </div>

      {currentLoad ? (
        <div className="rounded-3xl bg-ink-950 p-5 text-white">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">Current load</span>
            <LoadStagePill stage={currentLoad.stage} className="!bg-white/15 !text-white" />
          </div>
          <p className="mt-3 font-display text-2xl">
            {currentLoad.lane.origin}, {currentLoad.lane.originState}
            <span className="mx-1.5 text-white/40">→</span>
            {currentLoad.lane.destination}, {currentLoad.lane.destState}
          </p>
          <p className="mt-1 text-xs text-white/50">{currentLoad.referenceNumber} · {currentLoad.equipmentType} · {currentLoad.lane.miles} mi</p>

          <div className="mt-4">
            <Progress value={currentLoad.progressPct} barClassName="!bg-white" className="!bg-white/15" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-white/50">Pickup</p>
              <p className="mt-0.5 font-medium">{currentLoad.pickupWindow}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-white/50">Delivery</p>
              <p className="mt-0.5 font-medium">{currentLoad.deliveryWindow}</p>
            </div>
          </div>

          <Link href="/driver/messages" className="mt-4 flex items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-medium text-ink-950">
            <MessageCircle className="h-4 w-4" /> Message AI dispatcher
          </Link>
        </div>
      ) : (
        <div className="rounded-3xl border border-line p-6 text-center">
          <p className="text-sm text-ink-500">No active load — the AI is sourcing your next one now.</p>
        </div>
      )}

      {nextLoad && (
        <div className="rounded-3xl border border-line p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-[var(--accent-info)]">
              <Link2 className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Next load — already chained</span>
          </div>
          <p className="mt-2 font-medium text-ink-950">
            {nextLoad.lane.origin} <span className="text-ink-300">→</span> {nextLoad.lane.destination}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{nextLoad.stage === "negotiating" ? "AI is negotiating rate now" : "Rate locked — waiting on your current delivery"}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Miles this week" value={formatNumber(weekMiles)} />
        <Stat label="Loads" value={weekLoads.length} />
        <Stat label="HOS left" value={`${driver.hoursRemaining.toFixed(1)}h`} />
      </div>

      {truck && (
        <Link href="/driver/loads" className="flex items-center justify-between rounded-2xl border border-line px-4 py-3.5 text-sm text-ink-700">
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-ink-400" /> {truck.currentCity}, {truck.currentState}
          </span>
          <span className="flex items-center gap-1 text-ink-950">
            Load history <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-line p-3.5 text-center">
      <p className="font-display text-xl tabular text-ink-950">{value}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-ink-500">{label}</p>
    </div>
  );
}
