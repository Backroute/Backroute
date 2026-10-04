"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, ClipboardCheck, Link2, MapPin, Navigation, Phone } from "lucide-react";
import { DrivingMode } from "@/components/shared/driving-mode";
import { CallStatusLine } from "@/components/shared/call-settings";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { OwnerNeedsYou, useOwnerProfit } from "@/components/shared/owner-operator";
import { HomeTimeCard, useHomeTime } from "@/components/shared/home-time";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { DriverTripCompleteCard, type DriverTripCardProps } from "@/components/shared/driver-trip-card";
import { TripCompactCard, TripHeroMap, TripDetails, TripSheet } from "@/components/shared/trip-compact";
import { Switch } from "@/components/ui/switch";
import { NextLoadOffers } from "@/components/shared/next-load-offers";
import { IncidentCard } from "@/components/shared/incident-card";
import { ConsentCard } from "@/components/cloud/driver-dispatch-card";
import { QuickReplies } from "@/components/shared/quick-replies";
import { RoadTools } from "@/components/driver/road-tools";
import { useNextStopNotice } from "@/lib/next-stop";
import { useMoving } from "@/lib/moving";
import { OfflineBadge } from "@/components/shared/offline-badge";
import { useNow } from "@/lib/hooks";
import { keepLoadMap } from "@/lib/service-worker";
import { TripStops } from "@/components/driver/trip-stops";
import { cityCoords } from "@/lib/trip-geo";
import { weekEarnings } from "@/lib/earnings";
import { computeDriverPay } from "@/lib/settlements";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, useBrokerMap, truckActiveLoads, truckLineup } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { PRE_TRIP_STAGES } from "@/lib/trip-state";
import { cn, formatCurrency } from "@/lib/utils";
import { Lane } from "@/components/ui/lane";


export default function DriverHomePage() {
  const driver = usePrimaryDriver();
  const { t, solo } = useDriverUi();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const now = useNow();
  // Active incidents, plus ones the AI just finished — so the driver sees the "handled" moment before it goes.
  const incidents = useStore((s) => s.incidents).filter(
    (i) => i.driverId === driver.id && (i.status === "active" || (now !== null && now - Date.parse(i.steps.at(-1)?.timestamp ?? i.createdAt) < 20_000)),
  );
  const dvirInspections = useStore((s) => s.dvirInspections).filter((d) => d.driverId === driver.id);
  const requestBetterRate = useStore((s) => s.actions.requestBetterRate);
  const selectLoadOffer = useStore((s) => s.actions.selectLoadOffer);
  const requestOfferDetail = useStore((s) => s.actions.requestOfferDetail);
  const resolveOfferDetail = useStore((s) => s.actions.resolveOfferDetail);
  const driverConfirmStage = useStore((s) => s.actions.driverConfirmStage);
  const acknowledgeDelivery = useStore((s) => s.actions.acknowledgeDelivery);
  const confirmTripStep = useStore((s) => s.actions.confirmTripStep);
  const setSealNumber = useStore((s) => s.actions.setSealNumber);
  const uploadLoadDocument = useStore((s) => s.actions.uploadLoadDocument);
  const setAutoChain = useStore((s) => s.actions.setAutoChain);
  const startInboundCall = useStore((s) => s.actions.startInboundCall);
  const callDispatch = () => startInboundCall(driver.id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [driving, setDriving] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const reportIncident = useStore((s) => s.actions.reportIncident);

  const truck = trucks.find((t) => t.id === driver.truckId);
  const { current: currentLoad, next: nextLoad } = truckActiveLoads(loads, truck);
  const lineup = truckLineup(loads, truck);
  // The next loads' map areas are kept on the phone too, for the stretch after this one with no signal.
  const lineupKey = lineup.map((l) => l.id).join(",");
  useEffect(() => {
    for (const l of lineup.slice(0, 2)) keepLoadMap(cityCoords(l.lane.origin, l.lane.originState), cityCoords(l.lane.destination, l.lane.destState));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineupKey]);
  // The driver's next stop on the lock screen, when they turned it on (Profile).
  useNextStopNotice(currentLoad);
  // In a real account the office books loads with brokers; a company driver's app shows what's booked, not offers.
  const picksLoads = useStore((s) => s.session.mode !== "driver");
  const pendingOffers = loads.filter((l) => l.truckId === truck?.id && l.stage === "offered" && picksLoads);

  const offerGroups = (() => {
    const map = new Map<string, typeof pendingOffers>();
    for (const offer of pendingOffers) {
      if (!offer.offerGroupId) continue;
      map.set(offer.offerGroupId, [...(map.get(offer.offerGroupId) ?? []), offer]);
    }
    return Array.from(map.entries());
  })();
  const hasOffers = offerGroups.length > 0;

  const today = new Date().toDateString();
  const dvirDoneToday = dvirInspections.some((d) => d.kind === "pre_trip" && new Date(d.createdAt).toDateString() === today);
  const postTripDoneToday = dvirInspections.some((d) => d.kind === "post_trip" && new Date(d.createdAt).toDateString() === today);
  const needsPreTrip = !!currentLoad && !dvirDoneToday && PRE_TRIP_STAGES.includes(currentLoad.stage);
  const completedLoad = truck?.lastDeliveredLoadId ? loads.find((l) => l.id === truck.lastDeliveredLoadId) : undefined;
  const hasStageAction = !completedLoad && !!currentLoad && !!STAGE_CONFIRM[currentLoad.stage];
  const todoCount = Number(hasStageAction) + Number(hasOffers) + Number(!completedLoad && needsPreTrip) + incidents.filter((i) => i.status === "active").length;

  const autoPick = !!truck?.autoChainNextLoad;
  const toggleAutoPick = (on: boolean) => truck && setAutoChain(truck.id, on);
  const tripProps: DriverTripCardProps | null = currentLoad
    ? {
        load: currentLoad,
        brokerName: brokers.get(currentLoad.brokerId)?.company,
        truckCity: truck?.currentCity,
        truckState: truck?.currentState,
        needsPreTrip,
        upNext: nextLoad ? "chained" : hasOffers ? "choose" : "searching",
        onCall: callDispatch,
        onConfirm: (loadId) => {
          // Completing the delivery swaps in the "load complete" card — close the sheet so it's seen.
          if (currentLoad.stage === "at_delivery") setSheetOpen(false);
          driverConfirmStage(loadId);
        },
        onCounter: (amount) => requestBetterRate(currentLoad.id, "driver", amount),
        onTripStep: confirmTripStep,
        onSeal: setSealNumber,
        onUpload: uploadLoadDocument,
      }
    : null;

  const homeTime = useHomeTime(driver, truck, currentLoad);
  const ownerWeek = useOwnerProfit(truck);
  const weekPay = weekEarnings(loads.filter((l) => l.truckId === truck?.id)).loads.reduce((s, l) => s + computeDriverPay(l, driver, !!truck?.secondDriverId), 0);
  // Hands-free by itself when the truck starts moving (and back when it stops), unless the driver closed it.
  const moving = useMoving(!!currentLoad && !completedLoad);
  const [closedWhileMoving, setClosedWhileMoving] = useState(false);
  const [wasMoving, setWasMoving] = useState(false);
  if (moving !== wasMoving) {
    setWasMoving(moving);
    if (!moving) setClosedWhileMoving(false);
  }
  const showDriving = driving || (moving && !closedWhileMoving && !!currentLoad && !completedLoad);
  // The one thing every driver wants to know besides pay: when they're home.
  const homeWhen =
    driver.runType === "local" || driver.runType === "intown"
      ? homeTime?.state === "late"
        ? t.lateTonight
        : t.tonight
      : homeTime?.target
        ? homeTime.target.replace(/^Home (by |in )?/, "")
        : homeTime?.hoursHome != null
          ? `${Math.round(homeTime.hoursHome)} h away`
          : "—";

  // On a trip: the map comes first, the rest sits on a sheet over it (Uber-style).
  const hero = !!tripProps && !completedLoad;

  return (
    <div className="flex flex-col">
      {hero && tripProps && (
        <div className="-mt-3">
          <TripHeroMap {...tripProps} />
        </div>
      )}
    <div className={cn("relative z-10 flex flex-col gap-5 px-5", hero && "-mt-7 rounded-t-[1.75rem] bg-white pt-3 shadow-[0_-8px_24px_rgb(0_0_0/0.12)]")}>
      {hero && <span aria-hidden className="mx-auto -mb-2 block h-1.5 w-10 rounded-full bg-ink-200" />}
      <ConsentCard />
      <div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-ink-950">{t.hi(driver.name.split(" ")[0])}</h1>
          <OfflineBadge />
          {currentLoad && !completedLoad && (
            <button
              type="button"
              onClick={() => setDriving(true)}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--action)] px-4 py-2 text-sm font-semibold text-[var(--action-ink)]"
            >
              <Navigation className="h-3.5 w-3.5" /> {t.drivingMode}
            </button>
          )}
        </div>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-500">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", todoCount ? "bg-[var(--dot-warn)]" : "bg-[var(--dot-live)]")} />
          {completedLoad
            ? t.delivered
            : todoCount === 0
              ? t.nothingNeeds
              : t.thingsForYou(todoCount)}
        </p>
        {/* Pay and home in one quiet line: the trip below is what this screen is for. */}
        <Link href="/driver/earnings" className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-ink-50 px-4 py-3 text-sm">
          {/* An owner-operator keeps what the truck makes, so the number that matters is profit, not driver pay. */}
          <span className="min-w-0 truncate">
            <span className="font-semibold tabular text-ink-950">{formatCurrency(solo ? ownerWeek.net : weekPay)}</span>{" "}
            <span className="text-ink-500">{solo ? t.profitWeek : t.payWeek}</span>
          </span>
          <span className="shrink-0 text-ink-500">
            {driver.runType === "local" || driver.runType === "intown" ? t.hoursLeft(driver.hoursRemaining.toFixed(1)) : t.home}{" "}
            <span className="font-medium text-ink-950">{homeWhen}</span>
          </span>
        </Link>
      </div>

      {solo && <OwnerNeedsYou driver={driver} truck={truck} />}

      {incidents.map((incident) => (
        <IncidentCard key={incident.id} incident={incident} viewer="driver" />
      ))}

      {completedLoad && truck ? (
        <DriverTripCompleteCard
          load={completedLoad}
          brokerName={brokers.get(completedLoad.brokerId)?.company}
          nextLoad={currentLoad}
          offersCount={pendingOffers.length}
          postTripDone={postTripDoneToday}
          autoPick={autoPick}
          onAutoPick={toggleAutoPick}
          onContinue={() => acknowledgeDelivery(truck.id)}
        />
      ) : tripProps ? (
        <>
          <TripCompactCard {...tripProps} showMap={!hero} onOpen={() => setSheetOpen(true)} />
          <QuickReplies stage={tripProps.load.stage} onSent={(text) => setSentNote(text)} />
          {truck && <RoadTools load={tripProps.load} truck={truck} driver={driver} />}
          {truck?.trip && <TripStops truck={truck} loads={loads} hrefFor={(id) => `/driver/loads/${id}`} />}
          <TripSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Trip details">
            <TripDetails {...tripProps} autoPick={autoPick} onAutoPick={toggleAutoPick} loadHref={`/driver/loads/${tripProps.load.id}`} />
          </TripSheet>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-line p-6 text-center">
          {hasOffers ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink-800">
              No active load. Pick your next one below <ArrowDown className="h-4 w-4" />
            </p>
          ) : (
            <p className="text-sm text-ink-500">No load right now. Backroute is finding your next one.</p>
          )}
          <button onClick={callDispatch} className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-700">
            <Phone className="h-3.5 w-3.5" /> {t.callDispatch}
          </button>
        </div>
      )}

      {completedLoad && <QuickReplies stage={null} onSent={(text) => setSentNote(text)} />}
      {sentNote && (
        <p className="-mt-2 text-xs text-ink-600" role="status">
          Sent to dispatch: &ldquo;{sentNote}&rdquo;
        </p>
      )}

      {homeTime && <HomeTimeCard status={homeTime} />}

      <CallStatusLine driver={driver} />

      {nextLoad && !completedLoad && (
        <div className="rounded-3xl border border-line p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-info-soft text-[var(--accent-info)]">
                <Link2 className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-ink-400">Up next</span>
            </div>
            <LoadScoreBadge score={nextLoad.score} size="sm" />
          </div>
          <p className="mt-2 font-medium text-ink-950">
            <Lane from={nextLoad.lane.origin} to={nextLoad.lane.destination} />
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {nextLoad.stage === "negotiating" || nextLoad.stage === "scoring" || nextLoad.stage === "sourced"
              ? "Negotiating the rate now"
              : "Rate locked. It becomes your current load the moment you deliver."}
          </p>
          <div className="mt-2.5 flex items-center gap-4 text-xs">
            <span className="text-ink-500">Total offer <span className="font-semibold tabular text-ink-950">{formatCurrency(nextLoad.bookedRate ?? nextLoad.targetRate)}</span></span>
            <span className="text-ink-500">Est. net <span className="font-semibold tabular text-ink-950">{formatCurrency(nextLoad.netProfit ?? 0)}</span></span>
          </div>
          {nextLoad.stage === "negotiating" && (
            <div className="mt-3">
              <CounterOfferButton load={nextLoad} onSubmit={(amount) => requestBetterRate(nextLoad.id, "driver", amount)} variant="text" />
            </div>
          )}
          {lineup.filter((l) => l.id !== nextLoad.id).length > 0 && (
            <ol className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-xs" aria-label="Then">
              {lineup
                .filter((l) => l.id !== nextLoad.id)
                .map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span className="text-ink-500">
                      Then <span className="font-medium text-ink-900"><Lane from={l.lane.origin} to={l.lane.destination} /></span>
                    </span>
                    <span className="shrink-0 text-ink-500">{l.pickupWindow}</span>
                  </li>
                ))}
            </ol>
          )}
        </div>
      )}

      {hasOffers && (
        <div id="next-load" className="scroll-mt-4">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink-950">Pick for me</p>
              <p className="text-xs text-ink-500">Books the best fit now and every time after.</p>
            </div>
            <Switch checked={autoPick} onChange={toggleAutoPick} label="Pick my next load for me" />
          </div>
          <NextLoadOffers
            offerGroups={offerGroups}
            brokers={brokers}
            onSelect={(groupId, loadId) => selectLoadOffer(groupId, loadId, "driver")}
            onAsk={(loadId, text) => requestOfferDetail(loadId, text)}
            onAskResolve={(loadId, draft) => resolveOfferDetail(loadId, draft)}
          />
        </div>
      )}

      {truck && (
        <Link href="/driver/loads" className="flex items-center justify-between rounded-2xl border border-line px-4 py-3.5 text-sm text-ink-700">
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-ink-400" /> {truck.currentCity}, {truck.currentState}
          </span>
          <span className="flex items-center gap-1 text-ink-950">
            Load history <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}

      {truck && (
        <Link href="/driver/inspection" className="flex items-center justify-between rounded-2xl border border-line px-4 py-3.5 text-sm text-ink-700">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-ink-400" /> Inspections today
          </span>
          <span className="flex items-center gap-1 text-xs text-ink-950">
            Pre-trip {dvirDoneToday ? "✓" : "due"} · Post-trip {postTripDoneToday ? "✓" : "end of day"} <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}

      {showDriving && currentLoad && truck && (
        <DrivingMode
          load={currentLoad}
          needsPreTrip={needsPreTrip}
          onClose={() => {
            setDriving(false);
            if (moving) setClosedWhileMoving(true);
          }}
          onArrive={() => driverConfirmStage(currentLoad.id)}
          onTripStep={(step) => confirmTripStep(currentLoad.id, step)}
          onLate={() => reportIncident(driver.id, truck.id, "delay", "Reported hands-free while driving")}
          onCall={callDispatch}
        />
      )}
      </div>
    </div>
  );
}
