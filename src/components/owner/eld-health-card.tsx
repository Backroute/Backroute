"use client";

import { useState } from "react";
import { Gauge } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { useCarrierLoads, useCarrierTrucks } from "@/lib/selectors";
import { faultAdvice, milesUntilService, serviceEtaDays } from "@/lib/maintenance";
import { updateTruck } from "@/lib/back-office";
import { formatNumber } from "@/lib/utils";
import { TimeAgo } from "@/components/shared/time-ago";

/**
 * What the trucks themselves say, from the ELD: the odometer (so service comes due by real miles, with a date at the
 * truck's pace) and engine fault codes, worst first. A critical fault keeps the AI from booking the truck.
 */
export function EldHealthCard() {
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const demo = useStore((s) => s.session.mode === "demo");
  const [now] = useState(() => Date.now());
  const faults = trucks.flatMap((t) => (t.faults ?? []).map((f) => ({ truck: t, f }))).sort((a, b) => (a.f.severity === b.f.severity ? b.f.at.localeCompare(a.f.at) : a.f.severity === "critical" ? -1 : b.f.severity === "critical" ? 1 : a.f.severity === "warn" ? -1 : 1));
  const connected = trucks.some((t) => t.odometerAt);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4" /> From the trucks
          </CardTitle>
          <CardDescription>
            {connected || demo ? "Miles and engine codes from the ELD, read every few minutes." : "Connect Samsara or Motive in Settings → Connections and the odometer and engine codes come in by themselves."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 !pt-3">
        <ul className="flex flex-col gap-2" aria-label="Engine codes">
          {faults.map(({ truck, f }) => (
            <li key={`${truck.id}-${f.code}`} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-950">
                  {truck.unitNumber}: {f.description}
                </p>
                <p className="text-xs text-ink-500">
                  {f.code} · <TimeAgo iso={f.at} /> · {faultAdvice(f.severity)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={f.severity === "critical" ? "danger" : f.severity === "warn" ? "warning" : "neutral"}>{f.severity === "critical" ? "Stop" : f.severity === "warn" ? "Book it in" : "Info"}</Badge>
                <Button size="sm" variant="ghost" onClick={() => updateTruck(truck.id, { faults: (truck.faults ?? []).filter((x) => x.code !== f.code) })}>
                  Fixed
                </Button>
              </div>
            </li>
          ))}
          {!faults.length && <li className="text-sm text-ink-500">No engine codes on any truck.</li>}
        </ul>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Service by miles">
          {trucks.map((t) => {
            const left = milesUntilService(t);
            const eta = serviceEtaDays(t, loads, now);
            return (
              <li key={t.id} className="rounded-2xl bg-ink-50 px-4 py-3 text-sm">
                <p className="font-medium text-ink-950">
                  {t.unitNumber} <span className="font-normal text-ink-500">· {t.odometer != null ? `${formatNumber(t.odometer)} mi` : "odometer not in yet"}</span>
                </p>
                <p className={`text-xs ${left < 0 ? "text-[var(--accent-danger)]" : "text-ink-500"}`}>
                  {!Number.isFinite(left) ? "Service due: add the odometer or connect the ELD" : left < 0 ? `Service ${formatNumber(-left)} mi overdue` : `Service in ${formatNumber(left)} mi${eta !== null ? `, about ${eta} day${eta === 1 ? "" : "s"} at its pace` : ""}`}
                </p>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
