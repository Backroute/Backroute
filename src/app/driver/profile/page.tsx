"use client";

import { useState } from "react";
import { CalendarClock, DollarSign, Home, Phone, Star, Users } from "lucide-react";
import { CallSettingsCard } from "@/components/shared/call-settings";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { computeDriverPay, payLabel } from "@/lib/settlements";
import { HOME_TIME_OPTIONS, RUN_TYPE_DETAIL, RUN_TYPE_LABEL, RUN_TYPES } from "@/lib/run-types";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { HosStatus, TimeOffRequest } from "@/lib/types";

const TIME_OFF_TONE: Record<TimeOffRequest["status"], "warning" | "success" | "danger"> = {
  pending: "warning",
  approved: "success",
  denied: "danger",
};

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const HOS_TONE: Record<HosStatus, "success" | "neutral" | "info" | "warning"> = {
  driving: "success",
  on_duty: "info",
  off_duty: "neutral",
  sleeper: "warning",
};


export default function DriverProfilePage() {
  const driver = usePrimaryDriver();
  const carrier = usePrimaryCarrier();
  const trucks = useCarrierTrucks();
  const drivers = useStore((s) => s.drivers);
  const loads = useCarrierLoads();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const updateHomeTimeTarget = useStore((s) => s.actions.updateHomeTimeTarget);
  const setRunType = useStore((s) => s.actions.setRunType);
  const requestTimeOff = useStore((s) => s.actions.requestTimeOff);
  const myTimeOff = useStore((s) => s.timeOffRequests)
    .filter((r) => r.driverId === driver.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const [showTimeOffForm, setShowTimeOffForm] = useState(false);
  const [startDate, setStartDate] = useState(tomorrowIso());
  const [endDate, setEndDate] = useState(tomorrowIso());
  const [timeOffReason, setTimeOffReason] = useState("");

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

      <CallSettingsCard driver={driver} />

      {teammate && (
        <div className="rounded-2xl border border-line p-4">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-ink-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Team driver</p>
          </div>
          <p className="mt-1 text-xs text-ink-500">Pay per load is split between you.</p>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-ink-50 px-3.5 py-2.5">
            <div>
              <p className="text-sm font-medium text-ink-900">{teammate.name}</p>
              <p className="text-xs text-ink-400">{teammate.hoursRemaining.toFixed(1)}h of driving left</p>
            </div>
            <Badge tone={HOS_TONE[teammate.hosStatus]}>{teammate.hosStatus.replace("_", " ")}</Badge>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <Home className="h-3.5 w-3.5 text-ink-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">How you run</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="How you run">
          {RUN_TYPES.map((type) => (
            <button
              key={type}
              role="radio"
              aria-checked={driver.runType === type}
              onClick={() => setRunType(driver.id, type)}
              className={cn(
                "rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                driver.runType === type ? "bg-ink-950 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-150",
              )}
            >
              {RUN_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-500">{RUN_TYPE_DETAIL[driver.runType]}. The AI only books loads that fit.</p>

        {driver.runType !== "local" && (
          <>
            <p className="mt-4 text-xs font-medium text-ink-700">Home time</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {HOME_TIME_OPTIONS[driver.runType].map((opt) => (
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
          </>
        )}
        <p className="mt-3 text-xs text-ink-400">Home base: {driver.homeBase}</p>
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-3.5 w-3.5 text-ink-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Time off</p>
        </div>
        <p className="mt-1 text-xs text-ink-500">Always reviewed by your carrier directly. The AI never decides this one.</p>

        {myTimeOff.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {myTimeOff.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-ink-50 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink-900">{formatDate(r.startDate)} – {formatDate(r.endDate)}</p>
                  <p className="truncate text-[11px] text-ink-400">{r.reason}</p>
                </div>
                <Badge tone={TIME_OFF_TONE[r.status]}>{r.status}</Badge>
              </div>
            ))}
          </div>
        )}

        {showTimeOffForm ? (
          <div className="mt-3 flex flex-col gap-2.5">
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-ink-500">
                Start
                <input type="date" value={startDate} min={tomorrowIso()} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900" />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-ink-500">
                End
                <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900" />
              </label>
            </div>
            <input
              value={timeOffReason}
              onChange={(e) => setTimeOffReason(e.target.value)}
              placeholder="Reason (e.g. family event, medical, home time)"
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900 outline-none focus:border-ink-400"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!timeOffReason.trim()}
                onClick={() => {
                  requestTimeOff(driver.id, startDate, endDate, timeOffReason.trim());
                  setTimeOffReason("");
                  setShowTimeOffForm(false);
                }}
              >
                Submit request
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowTimeOffForm(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowTimeOffForm(true)}>
            Request time off
          </Button>
        )}
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
              {payLabel(driver)} · {formatCurrency(totalPay)} total
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
