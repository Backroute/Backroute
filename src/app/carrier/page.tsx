"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Link2 } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/shared/live-dot";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { LoadStagePill } from "@/components/shared/load-stage";
import { NextLoadOffers } from "@/components/shared/next-load-offers";
import { TruckDriverChip } from "@/components/shared/truck-driver-chip";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads, useCarrierTrucks, useCarrierDrivers, useCarrierEscalations, useDriverMap, useBrokerMap, useTruckMap } from "@/lib/selectors";
import { formatCurrency, formatNumber } from "@/lib/utils";

export default function CarrierOverviewPage() {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useCarrierTrucks();
  const drivers = useCarrierDrivers();
  const driverMap = useDriverMap();
  const brokers = useBrokerMap();
  const truckMap = useTruckMap();
  const escalations = useCarrierEscalations().filter((e) => e.status === "open");
  const activity = useStore((s) => s.activity).filter((e) => e.carrierId === carrier.id);
  const selectLoadOffer = useStore((s) => s.actions.selectLoadOffer);
  const requestBetterOfferPrice = useStore((s) => s.actions.requestBetterOfferPrice);

  const activeLoads = loads.filter((l) => l.stage !== "delivered");
  const netProfitMonth = loads.reduce((sum, l) => sum + (l.netProfit ?? 0), 0);
  const milesMonth = loads.reduce((sum, l) => sum + l.lane.miles, 0);
  const avgRpm = (() => {
    const withRpm = loads.filter((l) => l.rpm);
    if (!withRpm.length) return 0;
    return withRpm.reduce((s, l) => s + (l.rpm ?? 0), 0) / withRpm.length;
  })();
  const savingsMonth = carrier.avgSavingsPerTruck * trucks.length;
  const chainedCount = trucks.filter((t) => t.nextLoadId).length;

  const offerGroups = (() => {
    const map = new Map<string, typeof loads>();
    for (const load of loads) {
      if (load.stage !== "offered" || !load.offerGroupId) continue;
      map.set(load.offerGroupId, [...(map.get(load.offerGroupId) ?? []), load]);
    }
    return Array.from(map.entries());
  })();

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`${carrier.name} · ${trucks.length} trucks · ${carrier.plan} plan`}
        right={<LiveDot />}
      />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        {offerGroups.length > 0 && (
          <NextLoadOffers
            offerGroups={offerGroups}
            brokers={brokers}
            trucks={truckMap}
            drivers={driverMap}
            onSelect={(groupId, loadId) => selectLoadOffer(groupId, loadId, "carrier")}
            onNegotiate={(loadId) => requestBetterOfferPrice(loadId, "carrier")}
          />
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardContent>
              <StatTile label="Active loads" value={activeLoads.length} sublabel={`${loads.length} total this cycle`} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <StatTile label="Net profit" value={formatCurrency(netProfitMonth)} sublabel="Across booked & delivered loads" />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <StatTile label="Avg rate / mile" value={`$${avgRpm.toFixed(2)}`} sublabel={`${formatNumber(milesMonth)} miles run`} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <StatTile
                label="Saved vs. human dispatch"
                value={formatCurrency(savingsMonth)}
                sublabel="/mo across fleet"
                trend={{ direction: "up", value: `${trucks.length} trucks`, good: true }}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Fleet snapshot</CardTitle>
                  <p className="mt-1 text-xs text-ink-500">{chainedCount} of {trucks.length} trucks already have their next load chained</p>
                </div>
                <Button href="/carrier/fleet" variant="ghost" size="sm">
                  View fleet <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="!pt-4">
                <div className="flex flex-col divide-y divide-line">
                  {trucks.map((truck) => {
                    const driver = driverMap.get(truck.driverId ?? "");
                    const currentLoad = loads.find((l) => l.id === truck.currentLoadId);
                    const nextLoad = loads.find((l) => l.id === truck.nextLoadId);
                    return (
                      <div key={truck.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-xs font-semibold text-ink-700">
                            {truck.unitNumber.replace("T-", "")}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink-950">{truck.unitNumber} · {driver?.name ?? "Unassigned"}</p>
                            <p className="text-xs text-ink-500">{truck.equipmentType} · {truck.currentCity}, {truck.currentState}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {currentLoad ? (
                            <Link href={`/carrier/loads/${currentLoad.id}`}>
                              <LoadStagePill stage={currentLoad.stage} />
                            </Link>
                          ) : (
                            <Badge tone="neutral">Available</Badge>
                          )}
                          {nextLoad && (
                            <Badge tone="info" className="gap-1">
                              <Link2 className="h-3 w-3" /> Next chained
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Live activity</CardTitle>
                <Button href="/carrier/negotiations" variant="ghost" size="sm">
                  All negotiations <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="!pt-2">
                <ActivityFeed events={activity.slice(0, 8)} />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card className={escalations.length ? "border-[var(--accent-warn)]/40" : undefined}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-[var(--accent-warn)]" /> Needs your input
                </CardTitle>
              </CardHeader>
              <CardContent className="!pt-3">
                {escalations.length === 0 ? (
                  <p className="text-sm text-ink-400">Nothing needs your attention — the AI is handling everything.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {escalations.map((e) => {
                      const load = loads.find((l) => l.id === e.loadId);
                      const truck = load?.truckId ? truckMap.get(load.truckId) : undefined;
                      const driver = truck?.driverId ? driverMap.get(truck.driverId) : undefined;
                      return (
                        <div key={e.id} className="rounded-xl bg-amber-50/70 p-3">
                          {(truck || driver) && <TruckDriverChip truck={truck} driver={driver} className="mb-2 !bg-white/60" />}
                          <p className="text-xs leading-relaxed text-ink-800">{e.reason}</p>
                          <Link href={`/carrier/loads/${e.loadId}`} className="mt-2 inline-flex text-xs font-medium text-[var(--accent-warn)] hover:underline">
                            Review load →
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Driver roster</CardTitle>
              </CardHeader>
              <CardContent className="!pt-3">
                <div className="flex flex-col divide-y divide-line">
                  {drivers.slice(0, 5).map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                      <p className="text-sm text-ink-800">{d.name}</p>
                      <Badge tone={d.hosStatus === "driving" ? "success" : d.hosStatus === "off_duty" ? "neutral" : "info"}>
                        {d.hosStatus.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
