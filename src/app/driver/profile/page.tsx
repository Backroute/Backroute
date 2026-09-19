"use client";

import { DollarSign, Home, Phone, Star, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { computeDriverPay } from "@/lib/settlements";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
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
  const drivers = useStore((s) => s.drivers);
  const loads = useCarrierLoads();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const updateHomeTimeTarget = useStore((s) => s.actions.updateHomeTimeTarget);

  const isTeam = !!truck?.secondDriverId;
  const teammateId = truck?.driverId === driver.id ? truck?.secondDriverId : truck?.driverId;
  const teammate = teammateId ? drivers.find((d) => d.id === teammateId) : undefined;

  const paidLoads = loads
    .filter((l) => l.stage === "delivered" && l.truckId === truck?.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const totalPay = paidLoads.reduce((s, l) => s + computeDriverPay(l, driver, isTeam), 0);

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

      {teammate && (
        <div className="rounded-2xl border border-line p-4">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-ink-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Team driver</p>
          </div>
          <p className="mt-1 text-xs text-ink-500">Running as a team — one drives while the other&apos;s in the sleeper, so the truck covers more ground per day. Pay per load is split between you.</p>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-ink-50 px-3.5 py-2.5">
            <div>
              <p className="text-sm font-medium text-ink-900">{teammate.name}</p>
              <p className="text-xs text-ink-400">{teammate.hoursRemaining.toFixed(1)}h HOS remaining</p>
            </div>
            <Badge tone={HOS_TONE[teammate.hosStatus]}>{teammate.hosStatus.replace("_", " ")}</Badge>
          </div>
        </div>
      )}

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
        <div className="flex items-center gap-2">
          <DollarSign className="h-3.5 w-3.5 text-ink-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Pay statements</p>
        </div>
        {paidLoads.length === 0 ? (
          <p className="mt-2 text-xs text-ink-400">No delivered loads yet.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-500">
              {driver.payType === "percentage" ? `${Math.round(driver.payRate * 100)}% of rate` : `$${driver.payRate.toFixed(2)}/mi`} · {formatCurrency(totalPay)} total
            </p>
            <div className="mt-3 flex flex-col divide-y divide-line">
              {paidLoads.slice(0, 6).map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-800">{l.lane.origin} → {l.lane.destination}</p>
                    <p className="text-[11px] text-ink-400">{formatDate(l.updatedAt)}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular text-ink-950">{formatCurrency(computeDriverPay(l, driver, isTeam))}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

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
