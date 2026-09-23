"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUpRight, ChevronRight, ClipboardCheck, Clock, FileText, LifeBuoy, Link2, MapPin, MessageCircle, Phone, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { LoadJourney } from "@/components/shared/load-journey";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { StageConfirmButton } from "@/components/shared/stage-confirm-button";
import { NextLoadOffers } from "@/components/shared/next-load-offers";
import { VoiceCallModal } from "@/components/shared/voice-call-modal";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, useBrokerMap, truckActiveLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { DRIVER_IDLE_NOTE, LOAD_STATUS_HEADLINE, nextLoadStatus, nextStop } from "@/lib/load-status";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { LOAD_STAGE_LABEL, type Load, type LoadStage } from "@/lib/types";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

/** Stages where the truck hasn't rolled with freight yet — the window where a pre-trip DVIR is still due. */
const PRE_TRIP_STAGES: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup"];

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
  const [calling, setCalling] = useState(false);

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

  const dvirDoneToday = dvirInspections.some((d) => new Date(d.createdAt).toDateString() === new Date().toDateString());
  const needsPreTrip = !!currentLoad && !dvirDoneToday && PRE_TRIP_STAGES.includes(currentLoad.stage);
  const hasStageAction = !!currentLoad && !!STAGE_CONFIRM[currentLoad.stage];
  const todoCount = Number(hasStageAction) + Number(hasOffers) + Number(needsPreTrip) + incidents.length;

  const weekLoads = loads.filter((l) => l.truckId === truck?.id);
  const weekMiles = weekLoads.reduce((s, l) => s + l.lane.miles, 0);

  return (
    <div className="flex flex-col gap-5 px-5">
      <div>
        <h1 className="font-display text-2xl text-ink-950">Hi {driver.name.split(" ")[0]}</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-500">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", todoCount ? "bg-[var(--accent-warn)]" : "bg-[var(--accent-live)]")} />
          {todoCount === 0
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

      {currentLoad ? (
        <CurrentLoadCard
          load={currentLoad}
          nextStatus={nextLoadStatus(nextLoad, hasOffers)}
          needsPreTrip={needsPreTrip}
          onCall={() => setCalling(true)}
          onConfirm={driverConfirmStage}
          onCounter={(amount) => requestBetterRate(currentLoad.id, "driver", amount)}
        />
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

      {nextLoad && (
        <div className="rounded-3xl border border-line p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-[var(--accent-info)]">
                <Link2 className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Next load, already lined up</span>
            </div>
            <LoadScoreBadge score={nextLoad.score} size="sm" />
          </div>
          <p className="mt-2 font-medium text-ink-950">
            {nextLoad.lane.origin} <span className="text-ink-300">→</span> {nextLoad.lane.destination}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {nextLoad.stage === "negotiating"
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
            <ClipboardCheck className="h-4 w-4 text-ink-400" /> Vehicle inspection (DVIR)
          </span>
          <span className="flex items-center gap-1 text-ink-950">
            {dvirDoneToday ? "Done today" : "Start"} <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}

      {calling && <VoiceCallModal spec={{ kind: "checkin", driverId: driver.id, driverFirstName: driver.name }} onClose={() => setCalling(false)} />}
    </div>
  );
}

/** Built to be read at a glance from the cab: where you're going and when first, then the one thing to
 *  tap, then everything else. */
function CurrentLoadCard({
  load,
  nextStatus,
  needsPreTrip,
  onCall,
  onConfirm,
  onCounter,
}: {
  load: Load;
  nextStatus: ReturnType<typeof nextLoadStatus>;
  needsPreTrip: boolean;
  onCall: () => void;
  onConfirm: (loadId: string) => void;
  onCounter: (amount: number) => void;
}) {
  const stop = nextStop(load);
  const isDelivery = stop.label === "Delivery";
  const stopCity = isDelivery ? `${load.lane.destination}, ${load.lane.destState}` : `${load.lane.origin}, ${load.lane.originState}`;
  const idleNote = DRIVER_IDLE_NOTE[load.stage];

  return (
    <div className="rounded-3xl bg-ink-950 p-5 text-white">
      <Link href={`/driver/loads/${load.id}`} className="block">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">Current load · {load.referenceNumber}</span>
          <LoadScoreBadge score={load.score} size="sm" invert />
        </div>
        <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-white/50">{isDelivery ? "Deliver to" : "Pick up at"}</p>
        <p className="mt-0.5 text-2xl font-semibold leading-tight">{stopCity}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-white/80">
          <Clock className="h-3.5 w-3.5" /> {stop.window}
        </p>
        <p className="mt-2 text-xs text-white/40">
          {load.lane.origin} → {load.lane.destination} · {load.equipmentType} · {load.lane.miles} mi
        </p>
      </Link>

      <div className="mt-4 rounded-2xl bg-white/5 px-3 pb-3 pt-2.5">
        <p className="mb-2.5 text-xs font-medium text-white/80">{LOAD_STATUS_HEADLINE[load.stage] ?? LOAD_STAGE_LABEL[load.stage]}</p>
        <LoadJourney stage={load.stage} next={nextStatus} perspective="driver" invert />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {load.stage === "negotiating" && <CounterOfferButton load={load} onSubmit={onCounter} variant="dark" />}
        {STAGE_CONFIRM[load.stage] ? (
          <StageConfirmButton loadId={load.id} stage={load.stage} onConfirm={onConfirm} />
        ) : idleNote ? (
          <p className="flex items-start gap-2 rounded-2xl border border-white/15 px-3.5 py-3 text-xs leading-relaxed text-white/70">
            <Sparkles className="mt-px h-3.5 w-3.5 shrink-0" /> {idleNote}
          </p>
        ) : null}
        {needsPreTrip && (
          <Link href="/driver/inspection" className="flex items-center justify-between rounded-2xl bg-amber-400/15 px-3.5 py-2.5 text-xs font-medium text-amber-200">
            <span className="flex items-center gap-2"><ClipboardCheck className="h-3.5 w-3.5" /> Pre-trip inspection due today</span>
            <span className="flex items-center gap-0.5">Start <ChevronRight className="h-3.5 w-3.5" /></span>
          </Link>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-white/5 px-3.5 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Total offer</p>
          <p className="mt-0.5 text-sm font-semibold tabular">{formatCurrency(load.bookedRate ?? load.targetRate)}</p>
        </div>
        <div className="rounded-2xl bg-white/5 px-3.5 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Est. net</p>
          <p className="mt-0.5 text-sm font-semibold tabular">{formatCurrency(load.netProfit ?? 0)}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={onCall} className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-white/25 py-2.5 text-[11px] font-medium text-white">
          <Phone className="h-4 w-4" /> Call AI
        </button>
        <Link href="/driver/messages" className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-white/25 py-2.5 text-[11px] font-medium text-white">
          <MessageCircle className="h-4 w-4" /> Message
        </Link>
        <Link href="/driver/incident" className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-red-400/40 py-2.5 text-[11px] font-medium text-red-200">
          <LifeBuoy className="h-4 w-4" /> Report issue
        </Link>
      </div>

      <Link href={`/driver/loads/${load.id}`} className="mt-3 flex items-center justify-between rounded-2xl bg-white/5 px-3.5 py-2.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10">
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" /> Load details & documents{load.documents.length > 0 ? ` (${load.documents.length})` : ""}
        </span>
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
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
