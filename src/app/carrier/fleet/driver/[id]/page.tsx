"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Home, MessageCircle, Phone, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { DriverCheckInCard, useDriverRetention } from "@/components/shared/driver-retention";
import { emptiesAt, homeTimeLine, homeTimeTitle } from "@/components/shared/home-time";
import { DriverFileCard } from "@/components/owner/driver-file";
import { SafetyCard } from "@/components/owner/safety-card";
import { homeTimeStatus } from "@/lib/home";
import { RUN_TYPE_DETAIL, RUN_TYPE_LABEL, RUN_TYPES } from "@/lib/run-types";
import { LANGS } from "@/lib/lang";
import { useStore } from "@/lib/store";
import { payLabel } from "@/lib/settlements";
import { driverSeesLoadPay } from "@/lib/pay-view";
import { useCarrierLoads, useCarrierTrucks, truckActiveLoads } from "@/lib/selectors";
import { useNow } from "@/lib/hooks";
import type { Lang, RunType } from "@/lib/types";

/**
 * One driver, everything about them in one place: how they run and are paid, their hours and home time, their check-in,
 * their qualification file, safety, and the papers in their cab. The Fleet page keeps only what's needed at a glance.
 */
export default function DriverPage() {
  const { id } = useParams<{ id: string }>();
  const driver = useStore((s) => s.drivers.find((d) => d.id === id));
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const now = useNow();
  const setRunType = useStore((s) => s.actions.setRunType);
  const setDriverPrefs = useStore((s) => s.actions.setDriverPrefs);
  const setDriverSeesPay = useStore((s) => s.actions.setDriverSeesPay);
  const ownerOperator = useStore((s) => !!s.settings.ownerOperator);
  const retention = useDriverRetention().find((r) => r.driver.id === id);

  if (!driver) {
    return (
      <div className="px-4 py-16 text-center text-sm text-ink-500">
        That driver isn&apos;t on your roster.{" "}
        <Link href="/carrier/fleet" className="font-medium text-ink-950 underline">
          Back to Fleet
        </Link>
      </div>
    );
  }
  const truck = trucks.find((t) => t.driverId === driver.id || t.secondDriverId === driver.id);
  const { current } = truckActiveLoads(loads, truck);
  const at = truck ? emptiesAt(truck, current) : null;
  const home = at && now !== null ? homeTimeStatus(driver, at.city, at.state, new Date(now)) : null;
  const first = driver.name.split(" ")[0];
  const tel = driver.phone.replace(/[^\d+]/g, "");

  return (
    <div>
      <PageHeader title={driver.name} description={`${truck ? `${truck.unitNumber} · ` : ""}${driver.homeBase} · paid ${payLabel(driver)}`} />
      <div className="flex flex-col gap-5 px-4 py-6 sm:px-8">
        <Link href="/carrier/fleet" className="flex w-fit items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-950">
          <ArrowLeft className="h-3.5 w-3.5" /> Fleet
        </Link>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Avatar name={driver.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-950">{driver.name}</p>
              <p className="truncate text-xs text-ink-500">{driver.phone}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <a href={`tel:${tel}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink-100 px-3.5 text-xs font-semibold text-ink-900">
                <Phone className="h-3.5 w-3.5" /> Call {first}
              </a>
              <Link href={`/carrier/messages?driver=${driver.id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink-100 px-3.5 text-xs font-semibold text-ink-900">
                <MessageCircle className="h-3.5 w-3.5" /> Message
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>How {first} runs</CardTitle>
                <CardDescription>What Backroute books for them and how it talks to them.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 !pt-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span>
                  Runs
                  <span className="block text-xs text-ink-500">{RUN_TYPE_DETAIL[driver.runType]}</span>
                </span>
                <select
                  value={driver.runType}
                  onChange={(e) => setRunType(driver.id, e.target.value as RunType)}
                  aria-label={`How ${driver.name} runs`}
                  className="shrink-0 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-800 outline-none"
                >
                  {RUN_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {RUN_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>
                  Calls and texts in
                  <span className="block text-xs text-ink-500">Their app screens are set in the driver app.</span>
                </span>
                <select
                  value={driver.prefs?.language ?? "en"}
                  onChange={(e) => setDriverPrefs(driver.id, { language: e.target.value as Lang })}
                  aria-label={`Language ${driver.name} talks in`}
                  className="shrink-0 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-800 outline-none"
                >
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.native}
                    </option>
                  ))}
                </select>
              </label>
              {!ownerOperator && (
                <div className="flex items-center justify-between gap-3">
                  <span>
                    Sees what loads pay
                    <span className="block text-xs text-ink-500">{driverSeesLoadPay(driver, false) ? "Rate and profit on their loads" : "Only their own pay"}</span>
                  </span>
                  <Switch checked={driverSeesLoadPay(driver, false)} onChange={(on) => setDriverSeesPay(driver.id, on)} label={`${driver.name} sees what loads pay`} />
                </div>
              )}
              <Link href="/carrier/pay" className="flex items-center gap-1.5 text-xs font-medium text-ink-700 underline-offset-2 hover:underline">
                <Wallet className="h-3.5 w-3.5" /> Pay runs, deductions and expenses
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hours and home</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 !pt-3 text-sm">
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>{driver.hosStatus.replace("_", " ")}</span>
                <span className="tabular">{driver.hoursRemaining.toFixed(1)}h left</span>
              </div>
              <Progress value={Math.min(100, (driver.hoursRemaining / 11) * 100)} />
              {home && (
                <p className={`flex items-start gap-1.5 text-xs ${home.state === "late" ? "text-[var(--accent-warn)]" : "text-ink-600"}`}>
                  <Home className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    <span className="font-medium text-ink-900">{homeTimeTitle(home)}</span> · {homeTimeLine(home, "carrier")}
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {retention && retention.view.level !== "good" && <DriverCheckInCard driver={driver} view={retention.view} />}
        <DriverFileCard driver={driver} />
        <SafetyCard driver={driver} />
      </div>
    </div>
  );
}
