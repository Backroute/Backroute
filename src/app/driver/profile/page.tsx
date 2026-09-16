"use client";

import { Home, Phone, Star } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { usePrimaryDriver, useCarrierTrucks, usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import type { HosStatus } from "@/lib/types";

const HOS_TONE: Record<HosStatus, "success" | "neutral" | "info" | "warning"> = {
  driving: "success",
  on_duty: "info",
  off_duty: "neutral",
  sleeper: "warning",
};

const HOME_TIME_OPTIONS = ["No preference set", "Home by Friday", "Home by Saturday", "Home by Sunday"];

export default function DriverProfilePage() {
  const driver = usePrimaryDriver();
  const carrier = usePrimaryCarrier();
  const trucks = useCarrierTrucks();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const updateHomeTimeTarget = useStore((s) => s.actions.updateHomeTimeTarget);

  return (
    <div className="flex flex-col gap-5 px-5">
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <Avatar name={driver.name} size="lg" />
        <h1 className="font-display text-2xl text-ink-950">{driver.name}</h1>
        <p className="text-xs text-ink-500">{carrier.name}</p>
        <div className="mt-1 flex items-center gap-1 text-xs text-ink-600">
          <Star className="h-3.5 w-3.5 fill-current text-ink-950" /> {driver.rating.toFixed(1)} rating
        </div>
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-500">Hours of service</span>
          <Badge tone={HOS_TONE[driver.hosStatus]}>{driver.hosStatus.replace("_", " ")}</Badge>
        </div>
        <Progress value={(driver.hoursRemaining / 11) * 100} className="mt-2" />
        <p className="mt-1.5 text-xs text-ink-400">{driver.hoursRemaining.toFixed(1)} hours remaining today</p>
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <Home className="h-3.5 w-3.5 text-ink-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Home-time preference</p>
        </div>
        <p className="mt-1 text-xs text-ink-500">AI factors this in when scoring your next-load options.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {HOME_TIME_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => updateHomeTimeTarget(driver.id, opt)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                driver.homeTimeTarget === opt ? "bg-ink-950 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-150",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-400">Home base: {driver.homeBase}</p>
      </div>

      {truck && (
        <div className="rounded-2xl border border-line p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Truck</p>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Info label="Unit" value={truck.unitNumber} />
            <Info label="Equipment" value={truck.equipmentType} />
            <Info label="Odometer" value={`${formatNumber(truck.odometer)} mi`} />
            <Info label="MPG" value={truck.mpg.toFixed(1)} />
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-line p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Details</p>
        <div className="mt-2 flex flex-col gap-2.5 text-sm">
          <Info label="CDL" value={driver.cdl} />
          <Info label="Hired" value={formatDate(driver.hireDate)} />
          <Info label="Phone" value={driver.phone} />
        </div>
      </div>

      <a
        href={`tel:${driver.phone.replace(/[^\d+]/g, "")}`}
        className="flex items-center justify-center gap-2 rounded-full border border-line py-3 text-sm font-medium text-ink-700"
      >
        <Phone className="h-4 w-4" /> Call dispatch support
      </a>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-ink-400">{label}</p>
      <p className="font-medium text-ink-950">{value}</p>
    </div>
  );
}
