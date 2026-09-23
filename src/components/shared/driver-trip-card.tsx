"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, Camera, Check, ChevronRight, ClipboardCheck, Clock, FileText, LifeBuoy, Loader2, MessageCircle, Phone } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useNow } from "@/lib/hooks";
import { cityCoords, pickupLegStart, type LatLng } from "@/lib/trip-geo";
import { BOOKING_STAGES, tripState, type TripState } from "@/lib/trip-state";
import { Switch } from "@/components/ui/switch";
import { CounterOfferButton } from "./counter-offer-button";
import { SwipeToConfirm } from "./swipe-to-confirm";
import { TripMap } from "./trip-map";
import type { DriverDocType } from "@/lib/store";
import type { Load, LoadDocument } from "@/lib/types";

export type UploadedFile = { name: string; previewUrl?: string };

export interface DriverTripCardProps {
  load: Load;
  brokerName?: string;
  truckCity?: string;
  truckState?: string;
  needsPreTrip: boolean;
  /** What happens after this delivery — shown on the delivery card so the driver knows the next move. */
  upNext: "chained" | "choose" | "searching";
  /** The carrier sees the same cards read-only: the driver's steps show who they're waiting on instead of buttons. */
  viewer?: "driver" | "carrier";
  driverName?: string;
  onCall: () => void;
  /** Advances the load one stage (arrived → rolling → arrived → delivered). */
  onConfirm: (loadId: string) => void;
  onCounter: (amount: number) => void;
  onTripStep: (loadId: string, step: "loaded" | "unloaded") => void;
  onSeal: (loadId: string, sealNumber: string) => void;
  onUpload: (loadId: string, type: DriverDocType, file: UploadedFile) => void;
}

/** The full trip card, Uber-style: one card per phase. The booking card hands over to the pickup card the moment
 *  the AI dispatches the truck, the pickup card to the delivery card once the driver rolls, and so on. */
export function DriverTripCard(props: DriverTripCardProps) {
  const now = useNow();
  const s = tripState(props.load, now, props.needsPreTrip);
  return (
    <div key={`${props.load.id}-${s.card}`} className="animate-rise-in">
      {s.card === "booking" ? <BookingCard {...props} /> : s.card === "pickup" ? <PickupCard {...props} s={s} /> : <DeliveryCard {...props} s={s} />}
    </div>
  );
}

/** Who a step is waiting on, in the carrier's words. */
export function waitingOn(s: TripState, driverName?: string): string {
  return `${s.next.owner === "ai" ? "AI" : driverName?.split(" ")[0] ?? "Driver"}: ${s.next.title}`;
}

// ---------- Booking ----------

function BookingCard({ load, brokerName, viewer = "driver", onCall, onCounter }: DriverTripCardProps) {
  const rate = load.bookedRate ?? load.targetRate;
  const broker = brokerName ?? "the broker";
  const origin = `${load.lane.origin}, ${load.lane.originState}`;
  const destination = `${load.lane.destination}, ${load.lane.destState}`;
  const from = cityCoords(load.lane.origin, load.lane.originState);
  const to = cityCoords(load.lane.destination, load.lane.destState);
  const locked = load.stage === "rate_confirmed" || load.stage === "booked";
  const signed = load.stage === "booked";
  const s = tripState(load, null, false);

  return (
    <CardShell>
      {from && to && (
        <MapHeader from={from} to={to} laneKey={`${origin}|${destination}`} progress={0} showTruck={false}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70" /> AI is booking
        </MapHeader>
      )}
      <CardHeading kicker="Booking" reference={load.referenceNumber} title={`${load.lane.origin} → ${load.lane.destination}`} sub={`Pickup ${load.pickupWindow} · ${load.lane.miles} mi`} />
      <CompletionBar value={s.done} caption="AI is handling this" />

      <ol className="mt-5">
        <Step state="done" title="Found and scored" detail={`${load.score} match · ${formatCurrency(rate)} · est. net ${formatCurrency(load.netProfit ?? 0)}`} />
        <Step
          state={locked ? "done" : "current"}
          title={locked ? "Rate locked" : "Negotiating the rate"}
          detail={locked ? `${formatCurrency(rate)} with ${broker}` : `With ${broker} · asking ${formatCurrency(rate)}`}
        >
          {load.stage === "negotiating" && <CounterOfferButton load={load} onSubmit={onCounter} variant="dark" />}
        </Step>
        <Step state={signed ? "done" : locked ? "current" : "todo"} title="Rate confirmation signed" detail={signed ? "Signed and filed" : undefined} />
        <Step
          state={signed ? "current" : "todo"}
          title={viewer === "driver" ? "Dispatch to you" : "Dispatch to the driver"}
          detail={viewer === "driver" ? "Your pickup card opens the moment you're dispatched." : "The driver gets their pickup card the moment it's dispatched."}
          last
        />
      </ol>

      <p className="mt-4 rounded-2xl bg-white/5 px-4 py-3 text-sm text-white/70">
        {viewer === "driver" ? "Nothing for you to do. The AI books it and sends you to pickup." : "Nothing for you to do. The AI books it and dispatches the driver."}
      </p>
      {viewer === "driver" && <CardFooter load={load} rate={rate} onCall={onCall} />}
    </CardShell>
  );
}

// ---------- Pickup ----------

function PickupCard({ load, brokerName, truckCity, truckState, needsPreTrip, viewer = "driver", driverName, onCall, onConfirm, onTripStep, onSeal, onUpload, s }: DriverTripCardProps & { s: TripState }) {
  const readOnly = viewer === "carrier";
  const rate = load.bookedRate ?? load.targetRate;
  const originPt = cityCoords(load.lane.origin, load.lane.originState);
  const start = pickupLegStart(load, truckCity, truckState);
  const { arrived, handled: loaded, doc: bol, docDone: bolDone } = s;

  return (
    <CardShell>
      {start && originPt && (
        <MapHeader from={start} to={originPt} progress={arrived ? 1 : s.legP} showTruck>
          <LiveDot /> {arrived ? "At the shipper" : "Heading to pickup"}
        </MapHeader>
      )}
      <CardHeading
        kicker="Pickup"
        reference={load.referenceNumber}
        title={`${load.lane.origin}, ${load.lane.originState}`}
        sub={`${load.pickupWindow}${brokerName ? ` · ${brokerName}` : ""}`}
        aside={!arrived ? s.drive : undefined}
      />
      <CompletionBar value={s.done / s.total} caption={s.ready ? (readOnly ? "Ready to roll" : "All set, swipe to start the trip") : `${Math.floor(s.done)} of ${s.total} done`} />

      <ol className="mt-5">
        {needsPreTrip && (
          <Step state="current" title="Pre-trip inspection" detail={readOnly ? "The driver's daily inspection is still due." : "Required before you roll today."}>
            {!readOnly && <InspectionLink kind="pre_trip">Start pre-trip</InspectionLink>}
          </Step>
        )}
        <Step state={arrived ? "done" : "current"} title="Drive to the shipper" detail={arrived ? "Checked in" : s.drive} />
        <Step state={loaded ? "done" : arrived ? "current" : "todo"} title="Get loaded" detail={loaded ? "Loaded" : `${load.equipmentType} · ${load.weight.toLocaleString()} lbs`}>
          {arrived && !loaded && !readOnly && <PillButton onClick={() => onTripStep(load.id, "loaded")}>I&apos;m loaded</PillButton>}
        </Step>
        <Step state={bolDone ? "done" : arrived && loaded ? "current" : "todo"} title="Upload the signed BOL" last={!arrived}>
          {arrived && <DocumentSlot doc={bol} label="Photo of BOL" readOnly={readOnly} onFile={(f) => onUpload(load.id, "bol", f)} />}
        </Step>
        {arrived && (
          <Step state={load.tripChecklist?.sealNumber ? "done" : "todo"} title="Seal number" optional last>
            {readOnly ? (
              <p className="text-xs text-white/60">{load.tripChecklist?.sealNumber ?? "Not recorded yet"}</p>
            ) : (
              <SealInput value={load.tripChecklist?.sealNumber} onSave={(v) => onSeal(load.id, v)} />
            )}
          </Step>
        )}
      </ol>

      <div className="mt-5">
        {readOnly ? (
          <WaitingOn text={waitingOn(s, driverName)} />
        ) : !arrived ? (
          <SwipeToConfirm label="Swipe when you arrive" onConfirm={() => onConfirm(load.id)} />
        ) : (
          <SwipeToConfirm label="Swipe to start the trip" disabledLabel={lockReason(s, "BOL", needsPreTrip)} onConfirm={() => onConfirm(load.id)} />
        )}
      </div>
      <p className="mt-3 text-xs text-white/50">
        Then deliver to <span className="font-medium text-white/80">{load.lane.destination}, {load.lane.destState}</span> · {load.lane.miles} mi
      </p>
      {!readOnly && <CardFooter load={load} rate={rate} onCall={onCall} />}
    </CardShell>
  );
}

// ---------- Delivery ----------

function DeliveryCard({ load, brokerName, upNext, viewer = "driver", driverName, onCall, onConfirm, onTripStep, onUpload, s }: DriverTripCardProps & { s: TripState }) {
  const readOnly = viewer === "carrier";
  const rate = load.bookedRate ?? load.targetRate;
  const { arrived, handled: unloaded, doc: pod, docDone: podDone } = s;
  const lumper = load.documents.find((d) => d.type === "lumper_receipt");
  const origin = `${load.lane.origin}, ${load.lane.originState}`;
  const destination = `${load.lane.destination}, ${load.lane.destState}`;
  const from = cityCoords(load.lane.origin, load.lane.originState);
  const to = cityCoords(load.lane.destination, load.lane.destState);

  return (
    <CardShell>
      {from && to && (
        <MapHeader from={from} to={to} laneKey={`${origin}|${destination}`} progress={arrived ? 1 : s.legP} showTruck>
          <LiveDot /> {arrived ? "At the receiver" : "Heading to delivery"}
        </MapHeader>
      )}
      <CardHeading
        kicker="Delivery"
        reference={load.referenceNumber}
        title={destination}
        sub={`${load.deliveryWindow}${brokerName ? ` · ${brokerName}` : ""}`}
        aside={!arrived ? s.drive : undefined}
      />
      <CompletionBar value={s.done / s.total} caption={s.ready ? (readOnly ? "Ready to close out" : "All set, swipe to complete") : `${Math.floor(s.done)} of ${s.total} done`} />

      <ol className="mt-5">
        <Step state={arrived ? "done" : "current"} title="Drive to the receiver" detail={arrived ? "Checked in" : s.drive} />
        <Step state={unloaded ? "done" : arrived ? "current" : "todo"} title="Get unloaded" detail={unloaded ? "Unloaded" : undefined}>
          {arrived && !unloaded && !readOnly && <PillButton onClick={() => onTripStep(load.id, "unloaded")}>I&apos;m unloaded</PillButton>}
        </Step>
        <Step state={podDone ? "done" : arrived && unloaded ? "current" : "todo"} title="Upload the signed POD" last={!arrived}>
          {arrived && <DocumentSlot doc={pod} label="Photo of POD" readOnly={readOnly} onFile={(f) => onUpload(load.id, "pod", f)} />}
        </Step>
        {arrived && (
          <Step
            state={lumper?.status === "verified" ? "done" : "todo"}
            title="Lumper receipt"
            optional
            detail={lumper ? undefined : "Only if a lumper was paid. The AI files it for reimbursement."}
            last
          >
            {(!readOnly || lumper) && <DocumentSlot doc={lumper} label="Photo of receipt" readOnly={readOnly} onFile={(f) => onUpload(load.id, "lumper_receipt", f)} />}
          </Step>
        )}
      </ol>

      <div className="mt-5">
        {readOnly ? (
          <WaitingOn text={waitingOn(s, driverName)} />
        ) : !arrived ? (
          <SwipeToConfirm label="Swipe when you arrive" onConfirm={() => onConfirm(load.id)} />
        ) : (
          <SwipeToConfirm label="Swipe to complete delivery" disabledLabel={lockReason(s, "POD", false)} onConfirm={() => onConfirm(load.id)} />
        )}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-white/50">
        {upNext === "chained" ? (
          <>Next load already lined up <ArrowDown className="h-3.5 w-3.5" /></>
        ) : upNext === "choose" ? (
          <>Next-load options ready{readOnly ? "" : ", pick one below"} <ArrowDown className="h-3.5 w-3.5" /></>
        ) : (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> AI is lining up the next load</>
        )}
      </p>
      {!readOnly && <CardFooter load={load} rate={rate} onCall={onCall} />}
    </CardShell>
  );
}

/** Why the final swipe is still locked, in the order the driver has to fix it. */
export function lockReason(s: TripState, docName: "BOL" | "POD", preTrip: boolean): string | undefined {
  if (!s.handled) return docName === "BOL" ? "Confirm you're loaded to continue" : "Confirm you're unloaded to continue";
  if (!s.docDone) return s.doc ? `AI is checking the ${docName}…` : `Upload the ${docName} to continue`;
  if (preTrip) return "Do your pre-trip inspection first";
  return undefined;
}

// ---------- Complete ----------

/** Shown right after delivery until the driver moves on — the Uber "trip complete" moment, kept short: what you
 *  made, the paperwork the AI handled, the end-of-day inspection, and the next load (or the way to pick one). */
export function DriverTripCompleteCard({
  load,
  brokerName,
  nextLoad,
  offersCount,
  postTripDone,
  autoPick,
  onAutoPick,
  onContinue,
}: {
  load: Load;
  brokerName?: string;
  /** The chained load the truck was already promoted into, if any. */
  nextLoad?: Load;
  offersCount: number;
  postTripDone: boolean;
  autoPick: boolean;
  onAutoPick: (on: boolean) => void;
  onContinue: () => void;
}) {
  const rate = load.bookedRate ?? load.targetRate;
  const from = cityCoords(load.lane.origin, load.lane.originState);
  const to = cityCoords(load.lane.destination, load.lane.destState);
  const nextIsBooking = nextLoad ? BOOKING_STAGES.includes(nextLoad.stage) : false;

  function chooseNext() {
    onContinue();
    requestAnimationFrame(() => document.getElementById("next-load")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="animate-rise-in">
      <CardShell>
        {from && to && (
          <MapHeader
            from={from}
            to={to}
            laneKey={`${load.lane.origin}, ${load.lane.originState}|${load.lane.destination}, ${load.lane.destState}`}
            progress={1}
            showTruck
            compact
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-live)]">
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            Load complete
          </MapHeader>
        )}
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-white/60">Delivered to {load.lane.destination}, {load.lane.destState}</p>
            <p className="mt-0.5 text-4xl font-semibold tabular tracking-tight">{formatCurrency(load.netProfit ?? 0)}</p>
          </div>
          <p className="pb-1 text-right text-xs text-white/50">Est. net<br />{formatCurrency(rate)} · {load.lane.miles} mi</p>
        </div>
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-emerald-300">
          <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> POD checked</span>
          <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Invoice sent to {brokerName ?? "broker"}</span>
          <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Payment tracked</span>
        </p>

        <div className={cn("mt-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3", postTripDone ? "bg-white/5" : "bg-amber-400/15")}>
          <div className="flex items-center gap-2.5">
            <ClipboardCheck className={cn("h-4 w-4", postTripDone ? "text-emerald-300" : "text-amber-200")} />
            <div>
              <p className="text-sm font-medium">Post-trip inspection</p>
              <p className="text-[11px] text-white/55">{postTripDone ? "Logged for today" : "Required at the end of your driving day"}</p>
            </div>
          </div>
          {postTripDone ? <Check className="h-4 w-4 text-emerald-300" /> : <InspectionLink kind="post_trip">Start</InspectionLink>}
        </div>

        <div className="mt-3 rounded-2xl bg-white/5 p-4">
          {nextLoad ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/50">
                {nextIsBooking ? "Up next · AI is locking the rate" : "Up next · Pickup"}
              </p>
              <p className="mt-0.5 text-xl font-semibold">{nextLoad.lane.origin}, {nextLoad.lane.originState}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-white/70">
                <Clock className="h-3.5 w-3.5" /> {nextLoad.pickupWindow} · to {nextLoad.lane.destination}, {nextLoad.lane.destState}
              </p>
              <button onClick={onContinue} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-4 text-base font-semibold text-ink-950">
                Start next load <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              {offersCount > 0 ? (
                <>
                  <p className="text-sm text-white/80">AI found the top {offersCount} loads for your next trip.</p>
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
              <AutoPickRow on={autoPick} onChange={onAutoPick} className="mt-4 border-t border-white/10 pt-4" />
            </>
          )}
        </div>
      </CardShell>
    </div>
  );
}

// ---------- Building blocks (shared with the compact card and details sheet) ----------

export function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-3xl bg-ink-950 p-5 text-white shadow-xl shadow-ink-950/10", className)}>{children}</div>;
}

export function LiveDot() {
  return <span className="h-2 w-2 animate-pulse-dot rounded-full bg-[var(--accent-live)]" />;
}

export function AutoPickRow({ on, onChange, className }: { on: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div>
        <p className="text-sm font-medium">Auto-pick the next load</p>
        <p className="text-[11px] text-white/55">{on ? "AI books the best-scoring load for you." : "Off: you choose from the AI's top 3."}</p>
      </div>
      <Switch checked={on} onChange={onChange} label="Auto-pick the next load" dark />
    </div>
  );
}

export function InspectionLink({ kind, children }: { kind: "pre_trip" | "post_trip"; children: React.ReactNode }) {
  return (
    <Link
      href={`/driver/inspection?kind=${kind}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/20 px-3.5 py-2 text-xs font-semibold text-amber-200"
    >
      {children} <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function WaitingOn({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 rounded-2xl border border-white/15 px-4 py-3.5 text-sm text-white/70">
      <span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-white/60" /> {text}
    </p>
  );
}

/** The map bleeds to the card's edges with the status floating on it and a fade into the sheet below. */
export function MapHeader({
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
    <div className={cn("relative isolate -mx-5 -mt-5 mb-4 overflow-hidden", compact ? "h-36" : "h-52")}>
      <TripMap from={from} to={to} laneKey={laneKey} progress={progress} showTruck={showTruck} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-14 bg-gradient-to-t from-ink-950 to-transparent" />
      <span className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-ink-950/85 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
        {children}
      </span>
    </div>
  );
}

function CardHeading({ kicker, reference, title, sub, aside }: { kicker: string; reference: string; title: string; sub: string; aside?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
          {kicker} · {reference}
        </p>
        {aside && <p className="shrink-0 text-sm font-semibold tabular">{aside}</p>}
      </div>
      <p className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">{title}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-white/70">
        <Clock className="h-3.5 w-3.5 shrink-0" /> {sub}
      </p>
    </div>
  );
}

/** One continuous bar per card that fills as the phase's steps get done — full means ready to move on. */
export function CompletionBar({ value, caption, className }: { value: number; caption?: string; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cn("mt-4", className)}>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={caption ?? "Progress"}>
        <div className="h-full rounded-full bg-white transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {caption && <p className="mt-1.5 text-[11px] text-white/50">{caption}</p>}
    </div>
  );
}

function Step({
  state,
  title,
  detail,
  optional,
  last,
  children,
}: {
  state: "done" | "current" | "todo";
  title: string;
  detail?: React.ReactNode;
  optional?: boolean;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className={cn("relative flex gap-3", !last && "pb-4")}>
      {!last && <span aria-hidden className={cn("absolute bottom-0 left-[11px] top-7 w-px", state === "done" ? "bg-white/40" : "bg-white/15")} />}
      <span
        className={cn(
          "relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          state === "done" && "bg-white text-ink-950",
          state === "current" && "border-2 border-white",
          state === "todo" && "border border-white/25",
        )}
      >
        {state === "done" && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        {state === "current" && <span className="h-2 w-2 animate-pulse-dot rounded-full bg-white" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", state === "todo" && "text-white/45")}>
          {title}
          {optional && <span className="ml-1.5 text-[11px] font-normal text-white/40">Optional</span>}
          <span className="sr-only">{state === "done" ? ", done" : state === "current" ? ", in progress" : ", not started"}</span>
        </p>
        {detail && <div className="mt-0.5 text-xs text-white/55">{detail}</div>}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

export function PillButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-ink-950">
      <Check className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

/** Upload slot for a stop document: take a photo (or pick a file), see the AI read it, retake if needed. */
export function DocumentSlot({ doc, label, readOnly, onFile }: { doc?: LoadDocument; label: string; readOnly?: boolean; onFile: (file: UploadedFile) => void }) {
  const input = useRef<HTMLInputElement>(null);

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onFile({ name: file.name, previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined });
  }

  const picker = readOnly ? null : (
    <input ref={input} type="file" accept="image/*,application/pdf" onChange={handle} className="sr-only" tabIndex={-1} aria-label={label} />
  );

  if (!doc) {
    if (readOnly) return <p className="text-xs text-white/50">Waiting on the driver</p>;
    return (
      <>
        {picker}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-ink-950"
        >
          <Camera className="h-3.5 w-3.5" /> {label}
        </button>
      </>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-2.5">
      {picker}
      {doc.previewUrl ? (
        <span aria-hidden className="h-11 w-11 shrink-0 rounded-lg bg-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${doc.previewUrl})` }} />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10">
          <FileText className="h-4 w-4 text-white/60" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{doc.name}</p>
        {doc.status === "pending" ? (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/60">
            <Loader2 className="h-3 w-3 animate-spin" /> AI is reading it…
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] leading-snug text-emerald-300">AI checked: {doc.aiNote ?? "looks good"}</p>
        )}
      </div>
      {!readOnly && (
        <button type="button" onClick={() => input.current?.click()} className="shrink-0 px-1 text-[11px] font-semibold text-white/70 underline-offset-2 hover:underline">
          Retake
        </button>
      )}
    </div>
  );
}

function SealInput({ value, onSave }: { value?: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  const dirty = draft.trim() !== (value ?? "");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. 4471023"
        inputMode="numeric"
        aria-label="Seal number"
        className="min-w-0 flex-1 rounded-full border border-white/20 bg-transparent px-4 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/50"
      />
      {dirty && (
        <button type="submit" className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-semibold text-ink-950">
          Save
        </button>
      )}
    </form>
  );
}

function CardFooter({ load, rate, onCall }: { load: Load; rate: number; onCall: () => void }) {
  return (
    <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
      <Link href={`/driver/loads/${load.id}`} className="group min-w-0">
        <p className="flex items-center gap-1 text-sm font-semibold tabular">
          {formatCurrency(rate)} <ChevronRight className="h-3.5 w-3.5 text-white/40 transition-transform group-hover:translate-x-0.5" />
        </p>
        <p className="truncate text-[11px] text-white/50">Est. net {formatCurrency(load.netProfit ?? 0)} · {load.lane.miles} mi · Load page</p>
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
