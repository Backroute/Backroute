"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUpRight, CalendarClock, Check, LifeBuoy, Sparkles, X } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/shared/live-dot";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { LoadJourney } from "@/components/shared/load-journey";
import { NextLoadOffers } from "@/components/shared/next-load-offers";
import { TruckDriverChip } from "@/components/shared/truck-driver-chip";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads, useCarrierTrucks, useCarrierDrivers, useCarrierEscalations, useDriverMap, useBrokerMap, useTruckMap, truckActiveLoads } from "@/lib/selectors";
import { LOAD_STATUS_CARRIER, isTransitStage, nextLoadStatus, nextStop } from "@/lib/load-status";
import { cn, formatCurrency, formatNumber, formatDate } from "@/lib/utils";

export default function CarrierOverviewPage() {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useCarrierTrucks();
  const drivers = useCarrierDrivers();
  const driverMap = useDriverMap();
  const brokers = useBrokerMap();
  const truckMap = useTruckMap();
  const escalations = useCarrierEscalations().filter((e) => e.status !== "resolved");
  const activity = useStore((s) => s.activity).filter((e) => e.carrierId === carrier.id);
  const selectLoadOffer = useStore((s) => s.actions.selectLoadOffer);
  const requestOfferDetail = useStore((s) => s.actions.requestOfferDetail);
  const resolveOfferDetail = useStore((s) => s.actions.resolveOfferDetail);
  const resolveEscalation = useStore((s) => s.actions.resolveEscalation);
  const routeEscalationToSupport = useStore((s) => s.actions.routeEscalationToSupport);
  const respondTimeOff = useStore((s) => s.actions.respondTimeOff);
  const pendingTimeOff = useStore((s) => s.timeOffRequests).filter((r) => r.carrierId === carrier.id && r.status === "pending");

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
  const trucksWithOffers = new Set(offerGroups.map(([, group]) => group[0]?.truckId).filter(Boolean));

  const fleet = trucks.map((truck) => ({ truck, driver: driverMap.get(truck.driverId ?? ""), ...truckActiveLoads(loads, truck) }));
  const onRoad = fleet.filter((f) => f.current && isTransitStage(f.current.stage)).length;
  const booking = fleet.filter((f) => f.current && !isTransitStage(f.current.stage)).length;
  const available = fleet.filter((f) => !f.current).length;

  // Escalations already handed to Backroute Support are listed but no longer wait on the carrier.
  const waitingEscalations = escalations.filter((e) => e.status !== "with_support");
  const needsYouCount = waitingEscalations.length + pendingTimeOff.length + offerGroups.length;
  const hasNeedsYouItems = escalations.length + pendingTimeOff.length + offerGroups.length > 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`${carrier.name} · ${trucks.length} trucks · ${carrier.plan} plan`}
        right={<LiveDot />}
      />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <div className="rounded-3xl bg-ink-950 p-5 text-white sm:p-6">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/50">
            <Sparkles className="h-3.5 w-3.5" /> AI Dispatcher
          </p>
          <p className="mt-2 text-xl font-semibold leading-snug sm:text-2xl">
            {needsYouCount === 0
              ? "Nothing needs you. Every load is handled."
              : `${needsYouCount} thing${needsYouCount === 1 ? " needs" : "s need"} you. AI is handling everything else.`}
          </p>
          <p className="mt-1 text-sm text-white/60">
            {chainedCount} of {trucks.length} trucks already {chainedCount === 1 ? "has" : "have"} the next load lined up.
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <BannerTile label="On the road" value={onRoad} />
            <BannerTile label="AI booking" value={booking} />
            <BannerTile label="Available" value={available} />
          </div>
        </div>

        {hasNeedsYouItems && (
          <section id="needs-you" aria-labelledby="needs-you-title">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--accent-warn)]" />
              <h2 id="needs-you-title" className="text-sm font-semibold text-ink-950">Needs you</h2>
              {needsYouCount > 0 && <Badge tone="warning">{needsYouCount}</Badge>}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {offerGroups.map(([groupId, group]) => {
                const truck = group[0]?.truckId ? truckMap.get(group[0].truckId) : undefined;
                const driver = truck?.driverId ? driverMap.get(truck.driverId) : undefined;
                return (
                  <a key={groupId} href="#next-load" className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--accent-warn)]/40 bg-amber-50/70 p-4">
                    <div className="min-w-0">
                      {(truck || driver) && <TruckDriverChip truck={truck} driver={driver} className="mb-2 !bg-white/60" />}
                      <p className="text-sm font-medium text-ink-900">Pick the next load</p>
                      <p className="mt-0.5 text-xs text-ink-600">AI scored {group.length} option{group.length === 1 ? "" : "s"}. Your pick, then AI books it.</p>
                    </div>
                    <ArrowDown className="h-4 w-4 shrink-0 text-ink-500" />
                  </a>
                );
              })}

              {escalations.map((e) => {
                const load = loads.find((l) => l.id === e.loadId);
                const truck = load?.truckId ? truckMap.get(load.truckId) : undefined;
                const driver = truck?.driverId ? driverMap.get(truck.driverId) : undefined;
                return (
                  <div key={e.id} className={cn("rounded-2xl p-4", e.status === "with_support" ? "border border-line bg-ink-50" : "border border-[var(--accent-warn)]/40 bg-amber-50/70")}>
                    {(truck || driver) && <TruckDriverChip truck={truck} driver={driver} className="mb-2 !bg-white/60" />}
                    {e.complexity === "critical" && e.status !== "with_support" && (
                      <Badge tone="danger" className="mb-1.5">Needs a human judgment call</Badge>
                    )}
                    <p className="text-sm leading-relaxed text-ink-800">{e.reason}</p>
                    {e.status === "with_support" ? (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink-500">
                        <LifeBuoy className="h-3.5 w-3.5 animate-pulse" /> Backroute Support is reviewing this. You&apos;ll be notified.
                      </p>
                    ) : e.complexity === "routine" && e.recommendedAction && e.recommendedLabel ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Button size="sm" variant="primary" onClick={() => resolveEscalation(e.id, e.recommendedAction === "approve")}>
                          <Check className="h-3.5 w-3.5" /> {e.recommendedLabel}
                        </Button>
                        {e.loadId && (
                          <Link href={`/carrier/loads/${e.loadId}`} className="text-xs font-medium text-ink-500 hover:underline">
                            Review manually
                          </Link>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Button size="sm" variant="outline" onClick={() => routeEscalationToSupport(e.id)}>
                          <LifeBuoy className="h-3.5 w-3.5" /> Get human support
                        </Button>
                        {e.loadId && (
                          <Link href={`/carrier/loads/${e.loadId}`} className="text-xs font-medium text-ink-500 hover:underline">
                            Review load →
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {pendingTimeOff.map((r) => {
                const requester = driverMap.get(r.driverId);
                return (
                  <div key={r.id} className="rounded-2xl border border-line bg-white p-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                      <CalendarClock className="h-4 w-4 text-ink-400" /> Time off: {requester?.name ?? "Driver"}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">{formatDate(r.startDate)} – {formatDate(r.endDate)} · {r.reason}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <Button size="sm" variant="primary" onClick={() => respondTimeOff(r.id, true)}>
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => respondTimeOff(r.id, false)}>
                        <X className="h-3.5 w-3.5" /> Deny
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {offerGroups.length > 0 && (
          <div id="next-load" className="scroll-mt-4">
            <NextLoadOffers
              offerGroups={offerGroups}
              brokers={brokers}
              trucks={truckMap}
              drivers={driverMap}
              onSelect={(groupId, loadId) => selectLoadOffer(groupId, loadId, "carrier")}
              onAsk={(loadId, text) => requestOfferDetail(loadId, text)}
              onAskResolve={(loadId, draft) => resolveOfferDetail(loadId, draft)}
            />
          </div>
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Live loads</CardTitle>
              <p className="mt-1 text-xs text-ink-500">Where every truck is in the job, and who&apos;s on it.</p>
            </div>
            <Button href="/carrier/fleet" variant="ghost" size="sm">
              View fleet <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="!pt-2">
            <div className="flex flex-col divide-y divide-line">
              {fleet.map(({ truck, driver, current, next }) => {
                const hasOffers = trucksWithOffers.has(truck.id);
                const status = current ? LOAD_STATUS_CARRIER[current.stage] : undefined;
                const stop = current ? nextStop(current) : undefined;
                const href = current ? `/carrier/loads/${current.id}` : hasOffers ? "#next-load" : "/carrier/fleet";
                return (
                  <Link
                    key={truck.id}
                    href={href}
                    className="-mx-2 grid gap-3 rounded-xl px-2 py-4 transition-colors hover:bg-ink-50 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-center"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-xs font-semibold text-ink-700">
                        {truck.unitNumber.replace("T-", "")}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-ink-500">{truck.unitNumber} · {driver?.name ?? "Unassigned"}</p>
                        {current ? (
                          <p className="truncate text-sm font-medium text-ink-950">
                            {current.lane.origin}, {current.lane.originState} <span className="text-ink-300">→</span> {current.lane.destination}, {current.lane.destState}
                          </p>
                        ) : (
                          <p className="text-sm font-medium text-ink-950">Available in {truck.currentCity}, {truck.currentState}</p>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-500">
                          {status ? (
                            <>
                              <OwnerTag owner={status.owner} />
                              <span className="text-ink-700">{status.text}</span>
                              {stop && isTransitStage(current!.stage) && <span>· {stop.label} {stop.window}</span>}
                            </>
                          ) : hasOffers ? (
                            <span className="font-medium text-[var(--accent-warn)]">Needs your pick for the next load</span>
                          ) : (
                            <>
                              <OwnerTag owner="ai" />
                              <span>Sourcing the next load</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    {current && (
                      <LoadJourney
                        stage={current.stage}
                        next={nextLoadStatus(next, hasOffers)}
                        perspective="carrier"
                        compact
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardContent>
              <StatTile label="Active loads" value={activeLoads.length} sublabel={`${loads.length} total this cycle`} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <StatTile label="Net profit" value={formatCurrency(netProfitMonth)} sublabel="This cycle · includes projected loads" />
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
          <Card className="lg:col-span-2">
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

          <Card>
            <CardHeader>
              <CardTitle>Driver roster</CardTitle>
              {drivers.length > 5 && (
                <Button href="/carrier/fleet" variant="ghost" size="sm">
                  View all {drivers.length} <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              )}
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
  );
}

function BannerTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/5 px-3 py-2.5">
      <p className="font-display text-xl tabular">{value}</p>
      <p className="text-[11px] text-white/50">{label}</p>
    </div>
  );
}

function OwnerTag({ owner }: { owner: "ai" | "driver" }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
        owner === "ai" ? "bg-ink-100 text-ink-600" : "bg-emerald-50 text-[var(--accent-live)]",
      )}
    >
      {owner === "ai" ? "AI" : "Driver"}
    </span>
  );
}
