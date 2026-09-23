"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, Check, ChevronRight, ClipboardCheck, Clock, LifeBuoy, Loader2, MessageCircle, Phone } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { CounterOfferButton } from "./counter-offer-button";
import { StageConfirmButton } from "./stage-confirm-button";
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

/** What the card says at each stage: a short title, and one plain sentence telling the driver what to do. */
const STAGE_COPY: Partial<Record<LoadStage, { title: string; instruction: string }>> = {
  sourced: { title: "AI is booking your load", instruction: "Nothing to do yet. This card switches to your pickup once you're dispatched." },
  scoring: { title: "AI is booking your load", instruction: "Nothing to do yet. This card switches to your pickup once you're dispatched." },
  negotiating: { title: "AI is booking your load", instruction: "Nothing to do yet. This card switches to your pickup once you're dispatched." },
  rate_confirmed: { title: "Rate locked, dispatching you", instruction: "Nothing to do yet. This card switches to your pickup once you're dispatched." },
  booked: { title: "Booked, dispatching you", instruction: "Nothing to do yet. This card switches to your pickup once you're dispatched." },
  dispatched: { title: "Head to pickup", instruction: "Drive to the shipper. Tap below when you arrive." },
  at_pickup: { title: "At pickup", instruction: "Get loaded, then capture the signed BOL." },
  in_transit: { title: "Head to delivery", instruction: "Drive to the receiver. Tap below when you arrive." },
  at_delivery: { title: "At delivery", instruction: "Get unloaded, then capture the signed POD." },
};

interface CommonProps {
  load: Load;
  brokerName?: string;
  onCall: () => void;
}

/** The driver's one trip card, Uber-style: it's the same card the whole way through, but it only ever shows
 *  the current phase — booking, then pickup, then delivery — with one place, one time and one button. */
export function DriverTripCard({
  load,
  brokerName,
  needsPreTrip,
  upNext,
  onCall,
  onConfirm,
  onCounter,
}: CommonProps & {
  needsPreTrip: boolean;
  /** What happens after this delivery — shown on the delivery phase so the driver knows the next move. */
  upNext: "chained" | "choose" | "searching";
  onConfirm: (loadId: string) => void;
  onCounter: (amount: number) => void;
}) {
  const phase = phaseOf(load.stage);
  const copy = STAGE_COPY[load.stage] ?? { title: "Current load", instruction: "" };
  const rate = load.bookedRate ?? load.targetRate;
  const origin = `${load.lane.origin}, ${load.lane.originState}`;
  const destination = `${load.lane.destination}, ${load.lane.destState}`;

  return (
    <CardShell>
      <PhaseBar phase={phase} />
      <div key={`${load.id}-${load.stage}`} className="animate-rise-in">
        <p className="mt-5 flex items-center gap-2 text-sm font-semibold">
          {phase === "booking" ? (
            <Loader2 className="h-4 w-4 animate-spin text-white/70" />
          ) : (
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-[var(--accent-live)]" />
          )}
          {copy.title}
        </p>

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
            <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-white/50">{phase === "pickup" ? "Pickup" : "Delivery"}</p>
            <p className="mt-0.5 text-3xl font-semibold leading-tight tracking-tight">{phase === "pickup" ? origin : destination}</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-white/80">
              <Clock className="h-4 w-4" /> {phase === "pickup" ? load.pickupWindow : load.deliveryWindow}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {brokerName ? `${brokerName} · ` : ""}{load.referenceNumber} · {load.equipmentType}
            </p>
          </>
        )}

        <p className="mt-5 text-sm text-white/70">{copy.instruction}</p>

        <div className="mt-3 flex flex-col gap-2">
          {needsPreTrip && (
            <Link href="/driver/inspection" className="flex items-center justify-between rounded-2xl bg-amber-400/15 px-4 py-3 text-sm font-medium text-amber-200">
              <span className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Pre-trip inspection due</span>
              <span className="flex items-center gap-0.5 text-xs">Start <ChevronRight className="h-3.5 w-3.5" /></span>
            </Link>
          )}
          <StageConfirmButton loadId={load.id} stage={load.stage} onConfirm={onConfirm} className="py-4 text-base" />
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

/** Shown right after delivery until the driver moves on — the Uber "trip complete" moment: what you made,
 *  the paperwork the AI already handled, and the next load (or the way to pick one). */
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

  function chooseNext() {
    onContinue();
    requestAnimationFrame(() => document.getElementById("next-load")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <CardShell>
      <PhaseBar phase="done" />
      <div key={`${load.id}-done`} className="animate-rise-in">
        <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-emerald-300">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-live)] text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          Load complete
        </p>
        <p className="mt-4 text-sm text-white/60">Delivered to {load.lane.destination}, {load.lane.destState}</p>
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
  return <div className="rounded-3xl bg-ink-950 p-5 text-white shadow-xl shadow-ink-950/10">{children}</div>;
}

function PhaseBar({ phase }: { phase: Phase }) {
  const idx = PHASES.findIndex((p) => p.key === phase);
  return (
    <div aria-label={`Step ${idx + 1} of ${PHASES.length}: ${PHASES[idx].label}`}>
      <div className="grid grid-cols-4 gap-1.5">
        {PHASES.map((p, i) => (
          <div key={p.key} className="h-1 overflow-hidden rounded-full bg-white/15">
            <div
              className={cn(
                "h-full rounded-full bg-white transition-[width] duration-700 ease-out",
                i < idx || (i === idx && phase === "done") ? "w-full" : i === idx ? "w-1/2" : "w-0",
              )}
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
    <div className="mt-4 grid grid-cols-[12px_1fr] gap-x-3">
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

