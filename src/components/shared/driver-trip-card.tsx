"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, Check, ChevronRight, ClipboardCheck, Clock, LifeBuoy, Loader2, MessageCircle, Phone } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useNow } from "@/lib/hooks";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { cityCoords, formatEta, legFor, legMiles, legProgress, pickupLegStart, type LatLng } from "@/lib/trip-geo";
import { CounterOfferButton } from "./counter-offer-button";
import { SwipeToConfirm } from "./swipe-to-confirm";
import { TripMap } from "./trip-map";
import type { Load, LoadStage } from "@/lib/types";

type Phase = "booking" | "pickup" | "delivery" | "done";

const PHASES: { key: Phase; label: string }[] = [
  { key: "booking", label: "Booking" },
  { key: "pickup", label: "Pickup" },
  { key: "delivery", label: "Delivery" },
  { key: "done", label: "Done" },
];

function phaseOf(stage: LoadStage): Phase {
  if (stage === "dispatched" || stage === "at_pickup") return "pickup";
  if (stage === "in_transit" || stage === "at_delivery") return "delivery";
  if (stage === "delivered") return "done";
  return "booking";
}

/** How much of the current phase's segment is filled. Driving legs fill live with the truck; the booking
 *  segment steps forward as the AI gets further with the broker. */
const BOOKING_FILL: Partial<Record<LoadStage, number>> = { sourced: 0.2, scoring: 0.3, negotiating: 0.55, rate_confirmed: 0.8, booked: 0.9 };

function segmentFill(stage: LoadStage, legP: number): number {
  if (stage === "at_pickup" || stage === "at_delivery") return 0.92;
  if (stage === "dispatched" || stage === "in_transit") return 0.05 + legP * 0.8;
  return BOOKING_FILL[stage] ?? 0.2;
}

/** What the card says at each stage: a short title, and one plain sentence telling the driver what to do. */
const BOOKING_NOTE = "Nothing to do yet. This card switches to your pickup once you're dispatched.";
const STAGE_COPY: Partial<Record<LoadStage, { title: string; instruction: string }>> = {
  sourced: { title: "AI is booking your load", instruction: BOOKING_NOTE },
  scoring: { title: "AI is booking your load", instruction: BOOKING_NOTE },
  negotiating: { title: "AI is booking your load", instruction: BOOKING_NOTE },
  rate_confirmed: { title: "Rate locked, dispatching you", instruction: BOOKING_NOTE },
  booked: { title: "Booked, dispatching you", instruction: BOOKING_NOTE },
  dispatched: { title: "Head to pickup", instruction: "Drive to the shipper. Swipe when you arrive." },
  at_pickup: { title: "At pickup", instruction: "Get loaded, then swipe to capture the signed BOL." },
  in_transit: { title: "Head to delivery", instruction: "Drive to the receiver. Swipe when you arrive." },
  at_delivery: { title: "At delivery", instruction: "Get unloaded, then swipe to capture the signed POD." },
};

/** The driver's one trip card, Uber-style: a live map on top, ETA and a bar that fills as the truck moves,
 *  then one place, one time and one swipe. The same card the whole way through; only the phase changes. */
export function DriverTripCard({
  load,
  brokerName,
  truckCity,
  truckState,
  needsPreTrip,
  upNext,
  onCall,
  onConfirm,
  onCounter,
}: {
  load: Load;
  brokerName?: string;
  truckCity?: string;
  truckState?: string;
  needsPreTrip: boolean;
  /** What happens after this delivery — shown on the delivery phase so the driver knows the next move. */
  upNext: "chained" | "choose" | "searching";
  onCall: () => void;
  onConfirm: (loadId: string) => void;
  onCounter: (amount: number) => void;
}) {
  const now = useNow();
  const phase = phaseOf(load.stage);
  const copy = STAGE_COPY[load.stage] ?? { title: "Current load", instruction: "" };
  const step = STAGE_CONFIRM[load.stage];
  const rate = load.bookedRate ?? load.targetRate;
  const origin = `${load.lane.origin}, ${load.lane.originState}`;
  const destination = `${load.lane.destination}, ${load.lane.destState}`;

  const leg = legFor(load.stage);
  const legP = legProgress(load, now);
  const arrived = load.stage === "at_pickup" || load.stage === "at_delivery";
  const arriving = !arrived && legP >= 0.98;
  const milesLeft = leg ? Math.max(0, Math.round(legMiles(load, leg) * (1 - legP))) : 0;

  const originPt = cityCoords(load.lane.origin, load.lane.originState);
  const destPt = cityCoords(load.lane.destination, load.lane.destState);
  const mapFrom: LatLng | undefined = leg === "pickup" ? pickupLegStart(load, truckCity, truckState) : originPt;
  const mapTo: LatLng | undefined = leg === "pickup" ? originPt : destPt;
  const laneKey = leg === "pickup" ? undefined : `${origin}|${destination}`;

  const titleIcon =
    phase === "booking" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70" /> : <span className="h-2 w-2 animate-pulse-dot rounded-full bg-[var(--accent-live)]" />;

  return (
    <CardShell>
      {mapFrom && mapTo ? (
        <MapHeader from={mapFrom} to={mapTo} laneKey={laneKey} progress={leg ? legP : 0} showTruck={!!leg}>
          {titleIcon} {copy.title}
        </MapHeader>
      ) : (
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold">{titleIcon} {copy.title}</p>
      )}

      {leg && (
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-semibold tabular tracking-tight">{arrived ? "Arrived" : arriving ? "Arriving" : formatEta(milesLeft)}</p>
          <p className="text-sm tabular text-white/60">
            {arrived ? (leg === "pickup" ? "At the shipper" : "At the receiver") : arriving ? "Almost there" : `${milesLeft} mi left`}
          </p>
        </div>
      )}
      <PhaseBar phase={phase} fill={segmentFill(load.stage, legP)} className={leg ? "mt-3" : undefined} />

      <div key={`${load.id}-${load.stage}`} className="animate-rise-in">
        {phase === "booking" ? (
          <>
            <Route origin={origin} originNote={load.pickupWindow} destination={destination} destinationNote={load.deliveryWindow} />
            <p className="mt-4 text-xs text-white/60">
              {load.stage === "sourced" || load.stage === "scoring"
                ? `Reaching out to ${brokerName ?? "the broker"} · targeting ${formatCurrency(rate)}`
                : load.stage === "negotiating"
                  ? `Negotiating with ${brokerName ?? "the broker"} · asking ${formatCurrency(rate)}`
                  : `Rate locked at ${formatCurrency(rate)} with ${brokerName ?? "the broker"}`}
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-2/5 animate-indeterminate rounded-full bg-white/70" />
            </div>
          </>
        ) : (
          <>
            <p className="mt-5 text-[11px] font-medium uppercase tracking-wider text-white/50">{phase === "pickup" ? "Pickup" : "Delivery"}</p>
            <p className="mt-0.5 text-[26px] font-semibold leading-tight tracking-tight">{phase === "pickup" ? origin : destination}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-white/80">
              <Clock className="h-4 w-4" /> {phase === "pickup" ? load.pickupWindow : load.deliveryWindow}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {brokerName ? `${brokerName} · ` : ""}{load.referenceNumber} · {load.equipmentType}
            </p>
          </>
        )}

        <p className="mt-4 text-sm text-white/70">{copy.instruction}</p>

        <div className="mt-3 flex flex-col gap-2">
          {needsPreTrip && (
            <Link href="/driver/inspection" className="flex items-center justify-between rounded-2xl bg-amber-400/15 px-4 py-3 text-sm font-medium text-amber-200">
              <span className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Pre-trip inspection due</span>
              <span className="flex items-center gap-0.5 text-xs">Start <ChevronRight className="h-3.5 w-3.5" /></span>
            </Link>
          )}
          {step && (
            <SwipeToConfirm
              label={step.swipe}
              busyLabel={step.doc ? `Capturing ${step.doc.toUpperCase()}…` : undefined}
              delayMs={step.doc ? 700 : 0}
              onConfirm={() => onConfirm(load.id)}
            />
          )}
          {load.stage === "negotiating" && <CounterOfferButton load={load} onSubmit={onCounter} variant="dark" />}
        </div>

        {phase === "pickup" && (
          <p className="mt-3 text-xs text-white/50">
            Then deliver to <span className="font-medium text-white/80">{destination}</span> · {load.lane.miles} mi
          </p>
        )}
        {phase === "delivery" && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-white/50">
            {upNext === "chained" ? (
              <>Next load already lined up <ArrowDown className="h-3.5 w-3.5" /></>
            ) : upNext === "choose" ? (
              <>Next-load options ready, pick one below <ArrowDown className="h-3.5 w-3.5" /></>
            ) : (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> AI is lining up your next load</>
            )}
          </p>
        )}
      </div>

      <CardFooter load={load} rate={rate} onCall={onCall} />
    </CardShell>
  );
}

/** Shown right after delivery until the driver moves on — the Uber "trip complete" moment: the finished route,
 *  what you made, the paperwork the AI already handled, and the next load (or the way to pick one). */
export function DriverTripCompleteCard({
  load,
  brokerName,
  nextLoad,
  offersCount,
  onContinue,
}: {
  load: Load;
  brokerName?: string;
  /** The chained load the truck was already promoted into, if any. */
  nextLoad?: Load;
  offersCount: number;
  onContinue: () => void;
}) {
  const rate = load.bookedRate ?? load.targetRate;
  const from = cityCoords(load.lane.origin, load.lane.originState);
  const to = cityCoords(load.lane.destination, load.lane.destState);

  function chooseNext() {
    onContinue();
    requestAnimationFrame(() => document.getElementById("next-load")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <CardShell>
      {from && to ? (
        <MapHeader from={from} to={to} laneKey={`${load.lane.origin}, ${load.lane.originState}|${load.lane.destination}, ${load.lane.destState}`} progress={1} showTruck compact>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-live)]">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
          Load complete
        </MapHeader>
      ) : (
        <p className="mb-4 text-sm font-semibold text-emerald-300">Load complete</p>
      )}
      <PhaseBar phase="done" fill={1} />
      <div key={`${load.id}-done`} className="animate-rise-in">
        <p className="mt-5 text-sm text-white/60">Delivered to {load.lane.destination}, {load.lane.destState}</p>
        <p className="mt-1 text-4xl font-semibold tabular tracking-tight">{formatCurrency(load.netProfit ?? 0)}</p>
        <p className="text-xs text-white/50">Est. net · {formatCurrency(rate)} load · {load.lane.miles} mi</p>

        <ul className="mt-4 flex flex-col gap-1.5 text-sm text-white/80">
          <DoneItem>POD captured</DoneItem>
          <DoneItem>Invoice sent to {brokerName ?? "the broker"}</DoneItem>
          <DoneItem>AI is collecting payment</DoneItem>
        </ul>

        <div className="mt-5 rounded-2xl bg-white/5 p-4">
          {nextLoad ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/50">
                {phaseOf(nextLoad.stage) === "booking" ? "Up next · AI is locking the rate" : "Up next · Pickup"}
              </p>
              <p className="mt-0.5 text-xl font-semibold">{nextLoad.lane.origin}, {nextLoad.lane.originState}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-white/70">
                <Clock className="h-3.5 w-3.5" /> {nextLoad.pickupWindow} · to {nextLoad.lane.destination}, {nextLoad.lane.destState}
              </p>
              <button onClick={onContinue} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-4 text-base font-semibold text-ink-950">
                Start next load <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : offersCount > 0 ? (
            <>
              <p className="text-sm text-white/80">AI found {offersCount} load{offersCount === 1 ? "" : "s"} for your next trip.</p>
              <button onClick={chooseNext} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-white py-4 text-base font-semibold text-ink-950">
                Choose your next load <ArrowDown className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm text-white/80">
                <Loader2 className="h-4 w-4 animate-spin" /> AI is finding your next load
              </p>
              <button onClick={onContinue} className="mt-3 w-full rounded-full border border-white/25 py-3 text-sm font-semibold text-white">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </CardShell>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-3xl bg-ink-950 p-5 text-white shadow-xl shadow-ink-950/10">{children}</div>;
}

/** The map bleeds to the card's edges with the phase title floating on it and a fade into the sheet below. */
function MapHeader({
  from,
  to,
  laneKey,
  progress,
  showTruck,
  compact,
  children,
}: {
  from: LatLng;
  to: LatLng;
  laneKey?: string;
  progress: number;
  showTruck: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative isolate -mx-5 -mt-5 mb-4 overflow-hidden", compact ? "h-40" : "h-56")}>
      <TripMap from={from} to={to} laneKey={laneKey} progress={progress} showTruck={showTruck} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-14 bg-gradient-to-t from-ink-950 to-transparent" />
      <span className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-ink-950/85 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
        {children}
      </span>
    </div>
  );
}

/** Four segments; the current one fills live, so the bar visibly completes as the load moves. */
function PhaseBar({ phase, fill, className }: { phase: Phase; fill: number; className?: string }) {
  const idx = PHASES.findIndex((p) => p.key === phase);
  const overall = Math.round(((idx + (phase === "done" ? 1 : fill)) / PHASES.length) * 100);
  return (
    <div
      className={className}
      role="progressbar"
      aria-label={`${PHASES[idx].label}, step ${idx + 1} of ${PHASES.length}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, overall)}
    >
      <div className="grid grid-cols-4 gap-1.5">
        {PHASES.map((p, i) => (
          <div key={p.key} className="h-1.5 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-white transition-[width] duration-1000 ease-linear"
              style={{ width: `${(i < idx || phase === "done" ? 1 : i === idx ? fill : 0) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5 text-[10px]">
        {PHASES.map((p, i) => (
          <span key={p.key} className={i === idx ? "font-semibold text-white" : i < idx ? "text-white/60" : "text-white/30"}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Uber-style pickup → drop-off stack: dot, line, square. */
function Route({ origin, originNote, destination, destinationNote }: { origin: string; originNote: string; destination: string; destinationNote: string }) {
  return (
    <div className="mt-5 grid grid-cols-[12px_1fr] gap-x-3">
      <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-white" />
      <div>
        <p className="text-lg font-semibold leading-tight">{origin}</p>
        <p className="text-xs text-white/50">Pickup · {originNote}</p>
      </div>
      <span className="mx-auto my-1 h-5 w-px bg-white/25" />
      <span />
      <span className="mt-1.5 h-2.5 w-2.5 bg-white" />
      <div>
        <p className="text-lg font-semibold leading-tight">{destination}</p>
        <p className="text-xs text-white/50">Delivery · {destinationNote}</p>
      </div>
    </div>
  );
}

function CardFooter({ load, rate, onCall }: { load: Load; rate: number; onCall: () => void }) {
  return (
    <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
      <Link href={`/driver/loads/${load.id}`} className="group min-w-0">
        <p className="flex items-center gap-1 text-sm font-semibold tabular">
          {formatCurrency(rate)} <ChevronRight className="h-3.5 w-3.5 text-white/40 transition-transform group-hover:translate-x-0.5" />
        </p>
        <p className="truncate text-[11px] text-white/50">Est. net {formatCurrency(load.netProfit ?? 0)} · {load.lane.miles} mi · Details</p>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <button onClick={onCall} aria-label="Call AI Dispatcher" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/15">
          <Phone className="h-4 w-4" />
        </button>
        <Link href="/driver/messages" aria-label="Message AI Dispatcher" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/15">
          <MessageCircle className="h-4 w-4" />
        </Link>
        <Link href="/driver/incident" aria-label="Report an issue or emergency" className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/20 text-red-200 hover:bg-red-500/30">
          <LifeBuoy className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function DoneItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Check className="h-4 w-4 text-emerald-300" /> {children}
    </li>
  );
}
