"use client";

import { PapersWallet } from "@/components/driver/papers-wallet";
import { useEffect, useState } from "react";
import { CalendarClock, DollarSign, Home, Phone, Star, Users } from "lucide-react";
import { CallSettingsCard, LanguageCard } from "@/components/shared/call-settings";
import { BusinessCard } from "@/components/shared/owner-operator";
import { AppearanceCard } from "@/components/shared/appearance-card";
import { LockStopCard } from "@/components/shared/lock-stop-card";
import { SignOutButton } from "@/components/cloud/app-access";
import { ConsentCard, DriverDispatchCard } from "@/components/cloud/driver-dispatch-card";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { computeDriverPay } from "@/lib/settlements";
import { HOME_TIME_OPTIONS, RUN_TYPE_DETAIL, RUN_TYPE_LABEL, RUN_TYPES } from "@/lib/run-types";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { HosStatus, TimeOffRequest } from "@/lib/types";
import { LargeTitle } from "@/components/ui/large-title";
import { Lane } from "@/components/ui/lane";
import { payWords, usePagesText } from "@/lib/lang/pages-ui";
import { ReadingCard } from "@/components/driver/reading-card";

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


type ProfileTab = "me" | "truck" | "calls" | "app";

/** The tab a link asks for: ?tab=truck, or the old section anchors (#calls, #dispatch, #papers, #business). */
function tabFor(search: string, hash: string): ProfileTab {
  const asked = search.match(/[?&]tab=(me|truck|calls|app)/)?.[1] as ProfileTab | undefined;
  if (asked) return asked;
  if (/^#(calls|dispatch|consent)/.test(hash)) return "calls";
  if (/^#(papers|truck)/.test(hash)) return "truck";
  if (/^#(language|appearance|lock|reading)/.test(hash)) return "app";
  return "me";
}

export default function DriverProfilePage() {
  const { t } = useDriverUi();
  const p = usePagesText();
  // Four groups instead of one long page; a link can open one (?tab=truck).
  const [tab, setTab] = useState<ProfileTab>("me");
  // After the first paint, so the server's render and the phone's agree.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setTab(tabFor(window.location.search, window.location.hash)), []);
  const startInboundCall = useStore((s) => s.actions.startInboundCall);
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
        <LargeTitle title={driver.name} className="font-display text-2xl text-ink-950">{driver.name}</LargeTitle>
        <p className="text-xs text-ink-500">{carrier.name}</p>
        <div className="mt-1 flex items-center gap-1 text-xs text-ink-600">
          <Star className="h-3.5 w-3.5 fill-current text-ink-950" /> {p.profile.rating(driver.rating.toFixed(1))}
        </div>
      </div>

      <div role="tablist" aria-label={driver.name} className="-mx-1 flex gap-1 overflow-x-auto rounded-full bg-ink-100 p-1">
        {(["me", "truck", "calls", "app"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("min-h-10 flex-1 whitespace-nowrap rounded-full px-3 text-xs font-semibold", tab === k ? "bg-white text-ink-950 shadow-sm" : "text-ink-500")}
          >
            {p.profile.tabs[k]}
          </button>
        ))}
      </div>

      {tab === "me" && (
        <>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-500">{p.profile.hours}</span>
          <Badge tone={HOS_TONE[driver.hosStatus]}>{driver.hosStatus.replace("_", " ")}</Badge>
        </div>
        <Progress value={(driver.hoursRemaining / 11) * 100} className="mt-2" />
        <p className="mt-1.5 text-xs text-ink-400">{p.profile.hoursLeft(driver.hoursRemaining.toFixed(1))}</p>
      </div>

      <BusinessCard />

      {teammate && (
        <div className="rounded-2xl border border-line p-4">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-ink-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{p.profile.team}</p>
          </div>
          <p className="mt-1 text-xs text-ink-500">{p.profile.teamNote}</p>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-ink-50 px-3.5 py-2.5">
            <div>
              <p className="text-sm font-medium text-ink-900">{teammate.name}</p>
              <p className="text-xs text-ink-400">{p.profile.teamLeft(teammate.hoursRemaining.toFixed(1))}</p>
            </div>
            <Badge tone={HOS_TONE[teammate.hosStatus]}>{teammate.hosStatus.replace("_", " ")}</Badge>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <Home className="h-3.5 w-3.5 text-ink-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{p.profile.howRun}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label={p.profile.howRun}>
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
        <p className="mt-2 text-xs text-ink-500">{RUN_TYPE_DETAIL[driver.runType]}. {p.profile.runNote}</p>

        {driver.runType !== "local" && (
          <>
            <p className="mt-4 text-xs font-medium text-ink-700">{p.profile.homeTime}</p>
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
        <p className="mt-3 text-xs text-ink-400">{p.profile.homeBase(driver.homeBase)}</p>
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-3.5 w-3.5 text-ink-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{p.profile.timeOff}</p>
        </div>
        <p className="mt-1 text-xs text-ink-500">{p.profile.timeOffNote}</p>

        {myTimeOff.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {myTimeOff.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-ink-50 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink-900">{formatDate(r.startDate)} – {formatDate(r.endDate)}</p>
                  <p className="truncate text-xs text-ink-400">{r.reason}</p>
                </div>
                <Badge tone={TIME_OFF_TONE[r.status]}>{p.profile.status[r.status]}</Badge>
              </div>
            ))}
          </div>
        )}

        {showTimeOffForm ? (
          <div className="mt-3 flex flex-col gap-2.5">
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-ink-500">
                {p.profile.start}
                <input type="date" value={startDate} min={tomorrowIso()} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900" />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-ink-500">
                {p.profile.end}
                <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900" />
              </label>
            </div>
            <input
              value={timeOffReason}
              onChange={(e) => setTimeOffReason(e.target.value)}
              placeholder={p.profile.reason}
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
                {p.profile.submit}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowTimeOffForm(false)}>{p.profile.cancel}</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowTimeOffForm(true)}>
            {p.profile.request}
          </Button>
        )}
      </div>
        </>
      )}

      {tab === "truck" && (
        <>
      <PapersWallet />

      {truck && (
        <div className="rounded-2xl border border-line p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{p.profile.truck}</p>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Info label={p.profile.unit} value={truck.unitNumber} />
            <Info label={p.profile.equipment} value={truck.equipmentType} />
            <Info label={p.profile.odometer} value={`${formatNumber(truck.odometer)} mi`} />
            <Info label={p.profile.mpg} value={truck.mpg.toFixed(1)} />
          </div>
        </div>
      )}
        </>
      )}

      {tab === "me" && (
        <>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <DollarSign className="h-3.5 w-3.5 text-ink-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{p.profile.payStatements}</p>
        </div>
        {paidLoads.length === 0 ? (
          <p className="mt-2 text-xs text-ink-400">{p.profile.noDelivered}</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-500">
              {payWords(p, driver)} · {p.profile.total(formatCurrency(totalPay))}
            </p>
            <div className="mt-3 flex flex-col divide-y divide-line">
              {paidLoads.slice(0, 6).map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-800"><Lane from={l.lane.origin} to={l.lane.destination} /></p>
                    <p className="text-xs text-ink-400">{formatDate(l.updatedAt)}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular text-ink-950">{formatCurrency(computeDriverPay(l, driver, isTeam))}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-line p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{p.profile.details}</p>
        <div className="mt-2 flex flex-col gap-2.5 text-sm">
          <Info label={p.profile.cdl} value={driver.cdl} />
          <Info label={p.profile.hired} value={formatDate(driver.hireDate)} />
          <Info label={p.profile.phone} value={driver.phone} />
        </div>
      </div>
        </>
      )}

      {tab === "calls" && (
        <>
          <CallSettingsCard driver={driver} />
          <DriverDispatchCard />
          <ConsentCard always />
        </>
      )}

      {tab === "app" && (
        <>
          <LanguageCard driver={driver} />
          <AppearanceCard />
          <ReadingCard />
          <LockStopCard />
        </>
      )}

      {/* It reaches dispatch (the same line as everywhere else), not the driver's own number. */}
      <button
        type="button"
        onClick={() => startInboundCall(driver.id)}
        className="flex items-center justify-center gap-2 rounded-full border border-line py-3 text-sm font-medium text-ink-700"
      >
        <Phone className="h-4 w-4" /> {p.profile.callDispatch}
      </button>
      <SignOutButton label={t.signOut} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="font-medium text-ink-950">{value}</p>
    </div>
  );
}
