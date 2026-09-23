"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUpRight, ClipboardCheck, LifeBuoy, Link2, MapPin, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { DriverTripCompleteCard, type DriverTripCardProps } from "@/components/shared/driver-trip-card";
import { TripCompactCard, TripDetails, TripSheet } from "@/components/shared/trip-compact";
import { Switch } from "@/components/ui/switch";
import { NextLoadOffers } from "@/components/shared/next-load-offers";
import { VoiceCallModal } from "@/components/shared/voice-call-modal";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, useBrokerMap, truckActiveLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { PRE_TRIP_STAGES } from "@/lib/trip-state";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";


export default function DriverHomePage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const incidents = useStore((s) => s.incidents).filter((i) => i.driverId === driver.id && i.status === "active");
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
  const [calling, setCalling] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const truck = trucks.find((t) => t.id === driver.truckId);
  const { current: currentLoad, next: nextLoad } = truckActiveLoads(loads, truck);
  const pendingOffers = loads.filter((l) => l.truckId === truck?.id && l.stage === "offered");

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
  const todoCount = Number(hasStageAction) + Number(hasOffers) + Number(!completedLoad && needsPreTrip) + incidents.length;

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
        onCall: () => setCalling(true),
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

  const weekLoads = loads.filter((l) => l.truckId === truck?.id);
  const weekMiles = weekLoads.reduce((s, l) => s + l.lane.miles, 0);

  return (
    <div className="flex flex-col gap-5 px-5">
      <div>
        <h1 className="font-display text-2xl text-ink-950">Hi {driver.name.split(" ")[0]}</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-500">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", todoCount ? "bg-[var(--accent-warn)]" : "bg-[var(--accent-live)]")} />
          {completedLoad
            ? "Load delivered. Nice work."
            : todoCount === 0
              ? "Nothing needs you. AI Dispatcher has it handled."
              : `${todoCount} thing${todoCount === 1 ? "" : "s"} for you. AI handles the rest.`}
        </p>
      </div>

      {incidents.length > 0 && (
        <div className="rounded-2xl border border-[var(--accent-warn)]/40 bg-amber-50/60 p-4">
          {incidents.map((incident) => {
            const doneCount = incident.steps.filter((s) => s.status === "done").length;
            return (
              <div key={incident.id}>
                <div className="flex items-center gap-2">
                  <LifeBuoy className="h-4 w-4 text-[var(--accent-warn)]" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-warn)]">
                    {incident.type} reported, AI is on it
                  </span>
                </div>
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {incident.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`h-1.5 w-1.5 rounded-full ${step.status === "done" ? "bg-[var(--accent-live)]" : "bg-ink-300"}`} />
                      <span className={step.status === "done" ? "text-ink-700 line-through decoration-ink-300" : "text-ink-500"}>{step.label}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-ink-500">{doneCount}/{incident.steps.length} steps complete</p>
                {incident.humanNotified && (
                  <Badge tone="danger" className="mt-2">Human safety specialist notified</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

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
          <TripCompactCard {...tripProps} onOpen={() => setSheetOpen(true)} />
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
            <p className="text-sm text-ink-500">No active load. The AI is sourcing your next one now.</p>
          )}
          <button onClick={() => setCalling(true)} className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-700">
            <Phone className="h-3.5 w-3.5" /> Call AI Dispatcher
          </button>
        </div>
      )}

      {nextLoad && !completedLoad && (
        <div className="rounded-3xl border border-line p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-[var(--accent-info)]">
                <Link2 className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Up next</span>
            </div>
            <LoadScoreBadge score={nextLoad.score} size="sm" />
          </div>
          <p className="mt-2 font-medium text-ink-950">
            {nextLoad.lane.origin} <span className="text-ink-300">→</span> {nextLoad.lane.destination}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {nextLoad.stage === "negotiating" || nextLoad.stage === "scoring" || nextLoad.stage === "sourced"
              ? "AI is negotiating the rate now"
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
        </div>
      )}

      {hasOffers && (
        <div id="next-load" className="scroll-mt-4">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink-950">Let the AI pick for me</p>
              <p className="text-xs text-ink-500">Books the best-scoring option now and every time after.</p>
            </div>
            <Switch checked={autoPick} onChange={toggleAutoPick} label="Let the AI pick my next load" />
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

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Miles this week" value={formatNumber(weekMiles)} />
        <Stat label="Loads" value={weekLoads.length} />
        <Stat label="HOS left" value={`${driver.hoursRemaining.toFixed(1)}h`} />
      </div>

      {driver.homeTimeTarget !== "No preference set" && (
        <div className="flex items-center justify-between rounded-2xl border border-line px-4 py-3 text-sm">
          <span className="text-ink-600">Home-time preference</span>
          <Badge tone="info">{driver.homeTimeTarget}</Badge>
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

      {calling && <VoiceCallModal spec={{ kind: "checkin", driverId: driver.id, driverFirstName: driver.name }} onClose={() => setCalling(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-line p-3.5 text-center">
      <p className="font-display text-xl tabular text-ink-950">{value}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-ink-500">{label}</p>
    </div>
  );
}
