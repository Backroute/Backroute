"use client";

import Link from "next/link";
import { Link2, MapPin, Phone, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { LoadStagePill } from "@/components/shared/load-stage";
import { useCarrierTrucks, useDriverMap, useCarrierLoads, truckActiveLoads } from "@/lib/selectors";
import { useNow } from "@/lib/hooks";
import { formatNumber } from "@/lib/utils";
import type { HosStatus } from "@/lib/types";

/** A believable "GPS just pinged" freshness readout — deterministic per truck, ticks with the shared clock. */
function pingSecondsAgo(id: string, now: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash + Math.floor(now / 1000)) % 40;
}

const HOS_TONE: Record<HosStatus, "success" | "neutral" | "info" | "warning"> = {
  driving: "success",
  on_duty: "info",
  off_duty: "neutral",
  sleeper: "warning",
};

export default function FleetPage() {
  const trucks = useCarrierTrucks();
  const drivers = useDriverMap();
  const loads = useCarrierLoads();
  const now = useNow();

  return (
    <div>
      <PageHeader title="Fleet" description={`${trucks.length} trucks · ${drivers.size ?? 0} drivers on roster`} />

      <div className="grid gap-5 px-4 py-6 sm:px-8 sm:grid-cols-2 xl:grid-cols-3">
        {trucks.map((truck) => {
          const driver = drivers.get(truck.driverId ?? "");
          const { current: currentLoad, next: nextLoad } = truckActiveLoads(loads, truck);
          const pendingOffers = loads.filter((l) => l.truckId === truck.id && l.stage === "offered");
          const hosPct = driver ? Math.min(100, (driver.hoursRemaining / 11) * 100) : 0;

          return (
            <Card key={truck.id}>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-xl text-ink-950">{truck.unitNumber}</p>
                    <p className="text-xs text-ink-500">{truck.equipmentType} · {formatNumber(truck.odometer)} mi · {truck.mpg.toFixed(1)} mpg</p>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-400">
                      <MapPin className="h-3 w-3" /> {truck.currentCity}, {truck.currentState}
                      <span className="text-ink-300">·</span>
                      GPS via Samsara, {now === null ? "just now" : `${pingSecondsAgo(truck.id, now)}s ago`}
                    </p>
                  </div>
                  <Badge tone={truck.status === "available" ? "success" : truck.status === "on_load" ? "info" : "warning"}>
                    {truck.status.replace("_", " ")}
                  </Badge>
                </div>

                {driver && (
                  <div className="flex items-center gap-3">
                    <Avatar name={driver.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{driver.name}</p>
                      <p className="truncate text-xs text-ink-400">{driver.phone}</p>
                    </div>
                    <a href={`tel:${driver.phone.replace(/[^\d+]/g, "")}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200">
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}

                {driver && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-ink-500">
                      <span>HOS · <Badge tone={HOS_TONE[driver.hosStatus]}>{driver.hosStatus.replace("_", " ")}</Badge></span>
                      <span className="tabular">{driver.hoursRemaining.toFixed(1)}h left</span>
                    </div>
                    <Progress value={hosPct} className="mt-2" />
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t border-line pt-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-500">Current load</span>
                    {currentLoad ? (
                      <Link href={`/carrier/loads/${currentLoad.id}`}>
                        <LoadStagePill stage={currentLoad.stage} />
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-400">None — available</span>
                    )}
                  </div>
                  {currentLoad && (
                    <p className="text-xs text-ink-400">{currentLoad.lane.origin} → {currentLoad.lane.destination}</p>
                  )}
                  {nextLoad && (
                    <div className="mt-1 flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-[var(--accent-info)]">
                      <Link2 className="h-3 w-3" /> Next: {nextLoad.lane.origin} → {nextLoad.lane.destination}
                    </div>
                  )}
                  {pendingOffers.length > 0 && (
                    <Link href="/carrier/loads" className="mt-1 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-[var(--accent-warn)]">
                      <Sparkles className="h-3 w-3" /> {pendingOffers.length} load options awaiting a pick
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
