"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUpRight, CalendarClock, Check, LifeBuoy, Phone, Sparkles, UserRound, X } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/shared/live-dot";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { TripCompactCard, TripDetails, TripSheet } from "@/components/shared/trip-compact";
import type { DriverTripCardProps } from "@/components/shared/driver-trip-card";
import { Switch } from "@/components/ui/switch";
import { NextLoadOffers } from "@/components/shared/next-load-offers";
import { TruckDriverChip } from "@/components/shared/truck-driver-chip";
import { IncidentCard } from "@/components/shared/incident-card";
import { AutopilotControl } from "@/components/shared/autopilot-control";
import { DailyTextPreview } from "@/components/shared/daily-text";
import { DriverCallsBoard } from "@/components/shared/driver-calls-board";
import { DraftApproval, SourceTag } from "@/components/shared/draft-approval";
import { RuleSuggestion } from "@/components/cloud/owner-rules";
import { useDriverRetention } from "@/components/shared/driver-retention";
import { RUN_TYPE_LABEL } from "@/lib/run-types";
import { weekEarnings } from "@/lib/earnings";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads, useCarrierTrucks, useCarrierDrivers, useCarrierEscalations, useDriverMap, useBrokerMap, useTruckMap, truckActiveLoads } from "@/lib/selectors";
import { isTransitStage } from "@/lib/load-status";
import { PRE_TRIP_STAGES } from "@/lib/trip-state";
import type { Driver, Load, Truck } from "@/lib/types";
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
  const signedIn = useStore((s) => s.session.mode !== "demo");
  const routeEscalationToSupport = useStore((s) => s.actions.routeEscalationToSupport);
  const respondTimeOff = useStore((s) => s.actions.respondTimeOff);
  const pendingTimeOff = useStore((s) => s.timeOffRequests).filter((r) => r.carrierId === carrier.id && r.status === "pending");
  const dvirs = useStore((s) => s.dvirInspections);
  const setAutoChain = useStore((s) => s.actions.setAutoChain);
  const requestBetterRate = useStore((s) => s.actions.requestBetterRate);
  const [openTruckId, setOpenTruckId] = useState<string | null>(null);
  const now = useNow();
  const incidents = useStore((s) => s.incidents).filter(
    (i) => i.carrierId === carrier.id && (i.status === "active" || (now !== null && now - Date.parse(i.steps.at(-1)?.timestamp ?? i.createdAt) < 20_000)),
  );
  const liveCalls = loads.filter((l) => l.liveCall).length;
  const weekProfit = weekEarnings(loads).net;
  const dailyText = useStore((s) => s.settings.dailyText);
  const driversAtRisk = useDriverRetention().filter((r) => r.view.level === "at_risk");

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
  const openTrip = fleet.find((f) => f.truck.id === openTruckId);
  const today = new Date().toDateString();

  /** The same trip cards the driver sees, read-only: the driver's steps show who they're waiting on. */
  function carrierTripProps(truck: Truck, driver: Driver | undefined, current: Load, next: Load | undefined, hasOffers: boolean): DriverTripCardProps {
    const preTripDone = dvirs.some((d) => d.driverId === driver?.id && d.kind === "pre_trip" && new Date(d.createdAt).toDateString() === today);
    return {
      load: current,
      viewer: "carrier",
      driverName: driver?.name,
      brokerName: brokers.get(current.brokerId)?.company,
      truckCity: truck.currentCity,
      truckState: truck.currentState,
      needsPreTrip: !preTripDone && PRE_TRIP_STAGES.includes(current.stage),
      upNext: next ? "chained" : hasOffers ? "choose" : "searching",
      onCounter: (amount) => requestBetterRate(current.id, "carrier", amount),
      // Driver-only actions: the carrier's cards never render the controls that would call these.
      onCall: () => {},
      onConfirm: () => {},
      onTripStep: () => {},
      onSeal: () => {},
      onUpload: () => {},
    };
  }

  const onRoad = fleet.filter((f) => f.current && isTransitStage(f.current.stage)).length;
  const booking = fleet.filter((f) => f.current && !isTransitStage(f.current.stage)).length;
  const available = fleet.filter((f) => !f.current).length;

  // Escalations already handed to Backroute Support are listed but no longer wait on the carrier.
  const waitingEscalations = escalations.filter((e) => e.status !== "with_support");
  const needsYouCount = waitingEscalations.length + pendingTimeOff.length + offerGroups.length + driversAtRisk.length;
  const hasNeedsYouItems = escalations.filter((e) => !e.incidentId).length + pendingTimeOff.length + offerGroups.length + driversAtRisk.length > 0;

  return (
    <div>
      <PageHeader
        title="Today"
        description={`${carrier.name} · ${trucks.length} trucks · ${carrier.plan} plan`}
        right={<LiveDot />}
      />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <div className="rounded-3xl bg-ink-950 p-5 text-white sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/50">
              <Sparkles className="h-3.5 w-3.5" /> AI Dispatcher
            </p>
            <div className="text-right">
              <p className="text-3xl font-semibold tabular tracking-tight">{formatCurrency(weekProfit)}</p>
              <p className="text-[11px] text-white/50">profit this week</p>
            </div>
          </div>
          <p className="mt-2 text-xl font-semibold leading-snug sm:text-2xl">
            {needsYouCount === 0
              ? "Nothing needs you. Every load is handled."
              : `${needsYouCount} thing${needsYouCount === 1 ? " needs" : "s need"} you. AI is handling everything else.`}
          </p>
          <p className="mt-1 text-sm text-white/60">
            {chainedCount} of {trucks.length} trucks already {chainedCount === 1 ? "has" : "have"} the next load lined up.
            {liveCalls > 0 && ` AI is on ${liveCalls === 1 ? "a broker call" : `${liveCalls} broker calls`} right now.`}
          </p>
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/50">Autopilot</p>
            <AutopilotControl dark />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <BannerTile label="On the road" value={onRoad} />
            <BannerTile label="AI booking" value={booking} />
            <BannerTile label="Available" value={available} />
          </div>
        </div>

        {incidents.length > 0 && (
          <section aria-label="Incidents the AI is handling" className="grid gap-3 md:grid-cols-2">
            {incidents.map((incident) => {
              const truck = truckMap.get(incident.truckId);
              const driver = driverMap.get(incident.driverId);
              const esc = escalations.find((e) => e.id === incident.escalationId && e.status === "open");
              return (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  viewer="carrier"
                  label={`${truck?.unitNumber ?? "Truck"} · ${driver?.name ?? "Driver"}`}
                  onApprove={esc ? () => resolveEscalation(esc.id, true) : undefined}
                />
              );
            })}
          </section>
        )}

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
                  <div key={groupId} className="rounded-2xl border border-[var(--accent-warn)]/40 bg-amber-50/70 p-4">
                    {(truck || driver) && <TruckDriverChip truck={truck} driver={driver} className="mb-2 !bg-white/60" />}
                    <p className="text-sm font-medium text-ink-900">Pick the next load</p>
                    <p className="mt-0.5 text-xs text-ink-600">
                      {signedIn
                        ? `${group.length} load${group.length === 1 ? "" : "s"} from broker emails fit${group.length === 1 ? "s" : ""}. Pick one and the AI asks the broker to book it.`
                        : `AI found the top ${group.length}. Your pick, then AI books it.`}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button href="#next-load" size="sm" variant="primary">
                        Choose <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      {truck && !signedIn && (
                        <Button size="sm" variant="outline" onClick={() => setAutoChain(truck.id, true)}>
                          <Sparkles className="h-3.5 w-3.5" /> Let AI pick
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              {escalations.filter((e) => !e.incidentId).map((e) => {
                const load = loads.find((l) => l.id === e.loadId);
                const truck = load?.truckId ? truckMap.get(load.truckId) : undefined;
                const driver = truck?.driverId ? driverMap.get(truck.driverId) : undefined;
                return (
                  <div key={e.id} className={cn("rounded-2xl p-4", e.status === "with_support" ? "border border-line bg-ink-50" : "border border-[var(--accent-warn)]/40 bg-amber-50/70")}>
                    {(truck || driver) && <TruckDriverChip truck={truck} driver={driver} className="mb-2 !bg-white/60" />}
                    {e.complexity === "critical" && e.status !== "with_support" && (
                      <Badge tone="danger" className="mb-1.5">Needs a human judgment call</Badge>
                    )}
                    <SourceTag source={e.source} />
                    <p className="text-sm leading-relaxed text-ink-800">{e.reason}</p>
                    {e.suggestRule && signedIn ? (
                      <RuleSuggestion escalation={e} />
                    ) : e.draft && !(signedIn && e.status === "with_support") ? (
                      <DraftApproval escalation={e} />
                    ) : signedIn && e.status === "with_support" ? (
                      // A real account: Backroute's support team has it. The owner can still step in on an emergency.
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
                          <LifeBuoy className="h-3.5 w-3.5" /> Backroute support is on it. Nothing needed from you.
                        </p>
                        {e.complexity === "critical" && driver && (
                          <Button size="sm" variant="outline" href={`tel:${driver.phone.replace(/[^\d+]/g, "")}`}>
                            <Phone className="h-3.5 w-3.5" /> Call {driver.name.split(" ")[0]}
                          </Button>
                        )}
                      </div>
                    ) : signedIn && e.complexity === "critical" ? (
                      // A real account: no simulated support desk. The owner calls the driver and closes it out.
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        {driver && (
                          <Button size="sm" variant="primary" href={`tel:${driver.phone.replace(/[^\d+]/g, "")}`}>
                            <Phone className="h-3.5 w-3.5" /> Call {driver.name.split(" ")[0]}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => resolveEscalation(e.id, true)}>
                          <Check className="h-3.5 w-3.5" /> I&apos;ve handled it
                        </Button>
                      </div>
                    ) : e.status === "with_support" ? (
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

              {driversAtRisk.map(({ driver, view }) => (
                <div key={driver.id} className="rounded-2xl border border-[var(--accent-warn)]/40 bg-amber-50/70 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                    <UserRound className="h-4 w-4 text-ink-400" /> Check in with {driver.name}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-600">{view.signals.slice(0, 2).map((s) => s.text).join(" · ")}</p>
                  <div className="mt-3">
                    <Button size="sm" variant="primary" href="/carrier/fleet#retention">
                      See what to do
                    </Button>
                  </div>
                </div>
              ))}

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

        <section aria-labelledby="live-loads-title">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="live-loads-title" className="text-sm font-semibold text-ink-950">Live loads</h2>
              <p className="mt-0.5 text-xs text-ink-500">Tap a load for the full trip, the AI&apos;s log and the paperwork.</p>
            </div>
            <Button href="/carrier/fleet" variant="ghost" size="sm">
              View fleet <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fleet.map(({ truck, driver, current, next }) => {
              const hasOffers = trucksWithOffers.has(truck.id);
              if (!current) {
                return (
                  <div key={truck.id} className="flex flex-col justify-between gap-3 rounded-3xl border border-line bg-white p-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                        {truck.unitNumber} · {driver?.name ?? "Unassigned"}{driver ? ` · ${RUN_TYPE_LABEL[driver.runType]}` : ""}
                      </p>
                      <p className="mt-0.5 text-lg font-semibold text-ink-950">Available in {truck.currentCity}, {truck.currentState}</p>
                      <p className="mt-1 text-xs text-ink-500">
                        {hasOffers ? "AI's top options are waiting for your pick." : "AI is sourcing the next load."}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                      <span className="text-xs font-medium text-ink-700">Auto-pick the next load</span>
                      <Switch checked={!!truck.autoChainNextLoad} onChange={(on) => setAutoChain(truck.id, on)} label={`Auto-pick the next load for ${truck.unitNumber}`} />
                    </div>
                  </div>
                );
              }
              return (
                <TripCompactCard
                  key={truck.id}
                  {...carrierTripProps(truck, driver, current, next, hasOffers)}
                  showMap={false}
                  truckLabel={`${truck.unitNumber} · ${driver?.name ?? "Unassigned"}${driver ? ` · ${RUN_TYPE_LABEL[driver.runType]}` : ""}`}
                  onOpen={() => setOpenTruckId(truck.id)}
                />
              );
            })}
          </div>
        </section>

        <DriverCallsBoard />

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

        {dailyText && <DailyTextPreview />}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>AI log</CardTitle>
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

      {openTrip?.current && (
        <TripSheet open onClose={() => setOpenTruckId(null)} title={`${openTrip.truck.unitNumber} · ${openTrip.driver?.name ?? "Unassigned"}`} wide>
          <TripDetails
            {...carrierTripProps(openTrip.truck, openTrip.driver, openTrip.current, openTrip.next, trucksWithOffers.has(openTrip.truck.id))}
            autoPick={!!openTrip.truck.autoChainNextLoad}
            onAutoPick={(on) => setAutoChain(openTrip.truck.id, on)}
            loadHref={`/carrier/loads/${openTrip.current.id}`}
          />
        </TripSheet>
      )}
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
