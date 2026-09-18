"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronRight, FileText, LifeBuoy, Link2, MapPin, MessageCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TripProgress } from "@/components/shared/trip-progress";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { StageConfirmButton } from "@/components/shared/stage-confirm-button";
import { NextLoadOffers } from "@/components/shared/next-load-offers";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads, useBrokerMap, truckActiveLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { LOAD_STATUS_HEADLINE, isTransitStage, nextStop } from "@/lib/load-status";
import { LOAD_STAGE_LABEL } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

export default function DriverHomePage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const brokers = useBrokerMap();
  const incidents = useStore((s) => s.incidents).filter((i) => i.driverId === driver.id && i.status === "active");
  const requestBetterRate = useStore((s) => s.actions.requestBetterRate);
  const selectLoadOffer = useStore((s) => s.actions.selectLoadOffer);
  const requestOfferDetail = useStore((s) => s.actions.requestOfferDetail);
  const resolveOfferDetail = useStore((s) => s.actions.resolveOfferDetail);
  const driverConfirmStage = useStore((s) => s.actions.driverConfirmStage);

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

  const weekLoads = loads.filter((l) => l.truckId === truck?.id);
  const weekMiles = weekLoads.reduce((s, l) => s + l.lane.miles, 0);

  return (
    <div className="flex flex-col gap-5 px-5">
      <div>
        <p className="text-sm text-ink-500">Welcome back,</p>
        <h1 className="font-display text-2xl text-ink-950">{driver.name.split(" ")[0]}</h1>
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
                    {incident.type} reported — AI is on it
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
        <div className="rounded-3xl bg-ink-950 p-5 text-white">
          <Link href={`/driver/loads/${currentLoad.id}`} className="block">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">Current load</span>
              <LoadScoreBadge score={currentLoad.score} size="sm" invert />
            </div>
            <p className="mt-1.5 text-lg font-semibold">{LOAD_STATUS_HEADLINE[currentLoad.stage] ?? LOAD_STAGE_LABEL[currentLoad.stage]}</p>
            <p className="mt-0.5 text-sm text-white/70">
              {currentLoad.lane.origin}, {currentLoad.lane.originState}
              <span className="mx-1 text-white/40">→</span>
              {currentLoad.lane.destination}, {currentLoad.lane.destState}
            </p>
            <p className="mt-0.5 text-[11px] text-white/40">
              {currentLoad.referenceNumber} · {currentLoad.equipmentType} · {currentLoad.lane.miles} mi
            </p>

            <div className="mt-4">
              {isTransitStage(currentLoad.stage) ? (
                <TripProgress stage={currentLoad.stage} invert />
              ) : (
                <Progress value={currentLoad.progressPct} barClassName="!bg-white" className="!bg-white/15" />
              )}
            </div>

            <div className="mt-3.5 flex items-center justify-between text-xs text-white/50">
              <span>{nextStop(currentLoad).label} <span className="font-medium text-white">{nextStop(currentLoad).window}</span></span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-white/50">
              <span>Total offer <span className="font-medium text-white">{formatCurrency(currentLoad.bookedRate ?? currentLoad.targetRate)}</span></span>
              <span>Est. net <span className="font-medium text-white">{formatCurrency(currentLoad.netProfit ?? 0)}</span></span>
            </div>

            <div className="mt-3.5 flex items-center justify-between rounded-2xl bg-white/5 px-3.5 py-2.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10">
              <span>View details & documents</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </div>
          </Link>

          <div className="mt-3 flex flex-col gap-2">
            {currentLoad.stage === "negotiating" && (
              <CounterOfferButton load={currentLoad} onSubmit={(amount) => requestBetterRate(currentLoad.id, "driver", amount)} variant="dark" />
            )}
            <StageConfirmButton loadId={currentLoad.id} stage={currentLoad.stage} onConfirm={driverConfirmStage} />
            <div className="grid grid-cols-2 gap-2">
              <Link href="/driver/messages" className="flex items-center justify-center gap-2 rounded-full border border-white/25 py-3 text-sm font-medium text-white">
                <MessageCircle className="h-4 w-4" /> Message AI
              </Link>
              <Link href="/driver/incident" className="flex items-center justify-center gap-2 rounded-full border border-white/25 py-3 text-sm font-medium text-white">
                <LifeBuoy className="h-4 w-4" /> Report issue
              </Link>
            </div>
            {currentLoad.documents.length > 0 && (
              <Link href={`/driver/loads/${currentLoad.id}#documents`} className="flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-white/60 hover:text-white">
                <FileText className="h-3.5 w-3.5" /> {currentLoad.documents.length} document{currentLoad.documents.length === 1 ? "" : "s"} on file
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-line p-6 text-center">
          <p className="text-sm text-ink-500">No active load — the AI is sourcing your next one now.</p>
        </div>
      )}

      {nextLoad && (
        <div className="rounded-3xl border border-line p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-[var(--accent-info)]">
                <Link2 className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Next load — already chained</span>
            </div>
            <LoadScoreBadge score={nextLoad.score} size="sm" />
          </div>
          <p className="mt-2 font-medium text-ink-950">
            {nextLoad.lane.origin} <span className="text-ink-300">→</span> {nextLoad.lane.destination}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{nextLoad.stage === "negotiating" ? "AI is negotiating rate now" : "Rate locked — waiting on your current delivery"}</p>
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

      {offerGroups.length > 0 && (
        <NextLoadOffers
          offerGroups={offerGroups}
          brokers={brokers}
          onSelect={(groupId, loadId) => selectLoadOffer(groupId, loadId, "driver")}
          onAsk={(loadId, text) => requestOfferDetail(loadId, text)}
          onAskResolve={(loadId, draft) => resolveOfferDetail(loadId, draft)}
        />
      )}

      {driver.homeTimeTarget !== "No preference set" && (
        <div className="flex items-center justify-between rounded-2xl border border-line px-4 py-3 text-sm">
          <span className="text-ink-600">Home-time preference</span>
          <Badge tone="info">{driver.homeTimeTarget}</Badge>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Miles this week" value={formatNumber(weekMiles)} />
        <Stat label="Loads" value={weekLoads.length} />
        <Stat label="HOS left" value={`${driver.hoursRemaining.toFixed(1)}h`} />
      </div>

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
