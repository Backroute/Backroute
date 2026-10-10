"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { TripDetails, TripSheet } from "@/components/shared/trip-compact";
import type { DriverTripCardProps } from "@/components/shared/driver-trip-card";
import { Switch } from "@/components/ui/switch";
import { PickNextLoad, choiceCount } from "@/components/shared/pick-next-load";
import { TodayBoard } from "@/components/owner/today-board";
import { LiveLoadRow } from "@/components/owner/live-load-row";
import { StatusMark } from "@/components/ui/mark";
import { ContactRow } from "@/components/shared/contact-row";
import { IncidentCard } from "@/components/shared/incident-card";
import { DailyTextPreview } from "@/components/shared/daily-text";
import { WeeklyReviewCard } from "@/components/cloud/weekly-review-card";
import { GoingOutCard } from "@/components/cloud/going-out";
import { MoneyCard } from "@/components/cloud/money-card";
import { SetupProgress } from "@/components/cloud/setup-progress";
import { DriverCallsBoard } from "@/components/shared/driver-calls-board";
import { NeedsYouList, useNeedsYou } from "@/components/shared/needs-you";
import { PausedBanner } from "@/components/shared/ai-status";
import { SinceLastVisit } from "@/components/shared/since-last-visit";
import { FleetMap } from "@/components/shared/fleet-map";
import { SampleChecklist, TrySampleFleet } from "@/components/cloud/sample-fleet";
import { useRouter } from "next/navigation";
import { RUN_TYPE_LABEL } from "@/lib/run-types";
import { weekEarnings } from "@/lib/earnings";
import { useNow } from "@/lib/hooks";
import { useStore, AUTONOMY_LABEL } from "@/lib/store";
import { usePrimaryCarrier, useCarrierLoads, useCarrierTrucks, useDriverMap, useBrokerMap, useTruckMap, truckActiveLoads } from "@/lib/selectors";
import { isTransitStage } from "@/lib/load-status";
import { PRE_TRIP_STAGES } from "@/lib/trip-state";
import type { Driver, Load, Truck } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export default function CarrierOverviewPage() {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useCarrierTrucks();
  const driverMap = useDriverMap();
  const brokers = useBrokerMap();
  const truckMap = useTruckMap();
  const { escalations, offerGroups, count: needsYouCount } = useNeedsYou();
  const activity = useStore((s) => s.activity).filter((e) => e.carrierId === carrier.id);
  const resolveEscalation = useStore((s) => s.actions.resolveEscalation);
  const dvirs = useStore((s) => s.dvirInspections);
  const setAutoChain = useStore((s) => s.actions.setAutoChain);
  const requestBetterRate = useStore((s) => s.actions.requestBetterRate);
  const [openTruckId, setOpenTruckId] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const callNow = useStore((s) => s.dispatchCalls.some((c) => c.carrierId === carrier.id && (c.status === "live" || c.status === "ringing")));
  const router = useRouter();
  const now = useNow();
  const incidents = useStore((s) => s.incidents).filter(
    (i) => i.carrierId === carrier.id && (i.status === "active" || (now !== null && now - Date.parse(i.steps.at(-1)?.timestamp ?? i.createdAt) < 20_000)),
  );
  const liveCalls = loads.filter((l) => l.liveCall).length;
  const weekProfit = weekEarnings(loads).net;
  const dailyText = useStore((s) => s.settings.dailyText);
  const autonomy = useStore((s) => s.settings.autonomy);

  const chainedCount = trucks.filter((t) => t.nextLoadId).length;

  const trucksWithOffers = new Set(offerGroups.map(([, group]) => group[0]?.truckId).filter(Boolean));
  const choicesFor = (truckId: string) => choiceCount(offerGroups.filter(([, g]) => g[0]?.truckId === truckId));

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


  const hour = now === null ? null : new Date(now).getHours();
  const greeting = hour === null ? "Today" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const summary = [
    needsYouCount === 0 ? "Nothing needs you" : `${needsYouCount} need${needsYouCount === 1 ? "s" : ""} you`,
    `${formatCurrency(weekProfit)} profit this week`,
  ].join(" · ");

  return (
    <div>
      <PageHeader
        title={greeting}
        description={summary}
        right={
          <Link href="/carrier/settings" className="rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-150">
            Autopilot: {AUTONOMY_LABEL[autonomy]}
          </Link>
        }
      />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <PausedBanner />
        <SampleChecklist />
        <SinceLastVisit needsYou={needsYouCount} />
        <p className="text-sm text-ink-500">
          <span className="font-medium text-ink-950">{onRoad}</span> on the road · <span className="font-medium text-ink-950">{booking}</span> booking ·{" "}
          <span className="font-medium text-ink-950">{available}</span> available · {chainedCount} of {trucks.length} {trucks.length === 1 ? "has" : "have"} the next load lined up
          {liveCalls > 0 && ` · on ${liveCalls === 1 ? "a broker call" : `${liveCalls} broker calls`} now`}
        </p>

        <SetupProgress />
        <TrySampleFleet />
        <GoingOutCard />

        {incidents.length > 0 && (
          <section aria-label="Problems being handled" className="grid gap-3 md:grid-cols-2">
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

        <NeedsYouList />

        <TodayBoard />

        <section aria-labelledby="live-loads-title">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="live-loads-title" className="text-sm font-semibold text-ink-950">Live loads</h2>
              <p className="mt-0.5 text-xs text-ink-500">Tap one for the trip, the log and the paperwork.</p>
            </div>
            <Button href="/carrier/fleet" variant="ghost" size="sm">
              View fleet <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {/* One line per truck: a fleet fits on a phone screen. Empty trucks come after the moving ones. */}
          <div className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white">
            {[...fleet].sort((a, b) => Number(!a.current) - Number(!b.current)).map(({ truck, driver, current, next }) => {
              const hasOffers = trucksWithOffers.has(truck.id);
              const who = `${truck.unitNumber} · ${driver?.name ?? "Unassigned"}`;
              if (!current) {
                return (
                  <div key={truck.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <span className="flex h-4 w-3.5 shrink-0 items-center justify-center">
                      <StatusMark kind="off" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-950">Empty in {truck.currentCity}, {truck.currentState}</p>
                      <p className="truncate text-xs text-ink-500">
                        {who}{driver ? ` · ${RUN_TYPE_LABEL[driver.runType]}` : ""} · {hasOffers ? `${choicesFor(truck.id)} load${choicesFor(truck.id) === 1 ? "" : "s"} to pick from` : "looking for the next load"}
                      </p>
                    </div>
                    {hasOffers && (
                      <Button size="sm" onClick={() => setPicking(truck.id)}>
                        Choose
                      </Button>
                    )}
                    <span className="flex items-center gap-2 text-xs text-ink-500">
                      Auto-pick
                      <Switch checked={!!truck.autoChainNextLoad} onChange={(on) => setAutoChain(truck.id, on)} label={`Auto-pick the next load for ${truck.unitNumber}`} />
                    </span>
                  </div>
                );
              }
              const props = carrierTripProps(truck, driver, current, next, hasOffers);
              return <LiveLoadRow key={truck.id} load={current} who={who} needsPreTrip={!!props.needsPreTrip} onOpen={() => setOpenTruckId(truck.id)} />;
            })}
          </div>
        </section>

        {/* A call with a driver going on right now comes up; the call log, money and the rest wait under More. */}
        {callNow && <DriverCallsBoard />}

        <section aria-label="More">
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-3 text-sm font-medium text-ink-800 hover:bg-ink-50"
          >
            {more ? "Less" : "More: map, money, calls and what Backroute did"}
            <ChevronDown className={`h-4 w-4 text-ink-400 transition-transform ${more ? "rotate-180" : ""}`} />
          </button>
        </section>

        {more && (
        <>
        <FleetMap
          dots={fleet.map(({ truck, driver, current }) => ({ truck, driver, current }))}
          onSelect={(id) => (fleet.find((f) => f.truck.id === id)?.current ? setOpenTruckId(id) : router.push("/carrier/fleet"))}
        />

        {!callNow && <DriverCallsBoard />}

        {dailyText && <DailyTextPreview />}

        <MoneyCard />
        <WeeklyReviewCard />

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>What Backroute did</CardTitle>
            <Button href="/carrier/negotiations" variant="ghost" size="sm">
              All negotiations <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="!pt-2">
            <ActivityFeed events={activity.slice(0, 8)} />
          </CardContent>
        </Card>
        </>
        )}
      </div>

      <PickNextLoad truckId={picking} open={!!picking} onClose={() => setPicking(null)} />

      {openTrip?.current && (
        <TripSheet open onClose={() => setOpenTruckId(null)} title={`${openTrip.truck.unitNumber} · ${openTrip.driver?.name ?? "Unassigned"}`} wide>
          <ContactRow driver={openTrip.driver} broker={brokers.get(openTrip.current.brokerId)} className="px-2" />
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
