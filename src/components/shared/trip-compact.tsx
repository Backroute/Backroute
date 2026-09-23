"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronRight, ChevronUp, FileText, Loader2, Sparkles, X } from "lucide-react";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import { useEscapeKey, useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { cityCoords, pickupLegStart, type LatLng } from "@/lib/trip-geo";
import { tripState } from "@/lib/trip-state";
import { SwipeToConfirm } from "./swipe-to-confirm";
import { TripMap } from "./trip-map";
import { BrokerCallRow } from "./broker-call";
import {
  AutoPickRow,
  CardShell,
  CompletionBar,
  DocumentSlot,
  DockTimer,
  DriverTripCard,
  InspectionLink,
  LiveDot,
  PillButton,
  lockReason,
  waitingOn,
  type DriverTripCardProps,
} from "./driver-trip-card";

/** The small, always-current trip card — Uber's collapsed sheet: where, when, how far along, and the one next
 *  step (with its button when it's the driver's to take). Tap it for everything else. */
export function TripCompactCard({
  onOpen,
  showMap = true,
  truckLabel,
  ...props
}: DriverTripCardProps & { onOpen: () => void; showMap?: boolean; truckLabel?: string }) {
  const { load, needsPreTrip, viewer = "driver", driverName, onConfirm, onTripStep, onUpload } = props;
  const now = useNow();
  const s = tripState(load, now, needsPreTrip);
  const driver = viewer === "driver";
  const origin = `${load.lane.origin}, ${load.lane.originState}`;
  const destination = `${load.lane.destination}, ${load.lane.destState}`;
  const originPt = cityCoords(load.lane.origin, load.lane.originState);
  const destPt = cityCoords(load.lane.destination, load.lane.destState);

  const kicker = s.card === "booking" ? "Booking" : s.card === "pickup" ? "Pickup" : "Delivery";
  const place = s.card === "booking" ? `${load.lane.origin} → ${load.lane.destination}` : s.card === "pickup" ? origin : destination;
  const status =
    s.card === "booking" ? "AI is booking" : s.arrived ? (s.card === "pickup" ? "At the shipper" : "At the receiver") : s.card === "pickup" ? "Heading to pickup" : "Heading to delivery";
  const mapFrom: LatLng | undefined = s.card === "pickup" ? pickupLegStart(load, props.truckCity, props.truckState) : originPt;
  const mapTo: LatLng | undefined = s.card === "pickup" ? originPt : destPt;
  const progress = s.card === "booking" ? 0 : s.arrived ? 1 : s.legP;
  const docName = s.card === "pickup" ? "BOL" : "POD";
  const action = driver ? s.next.action : null;
  const contact = useStore((st) => st.brokers.find((b) => b.id === load.brokerId)?.contact);

  return (
    <CardShell className="p-0">
      {showMap && mapFrom && mapTo && (
        <button type="button" onClick={onOpen} aria-label="Open trip details" className="relative isolate block h-28 w-full overflow-hidden text-left">
          <TripMap from={mapFrom} to={mapTo} laneKey={s.card === "pickup" ? undefined : `${origin}|${destination}`} progress={progress} showTruck={s.card !== "booking"} compact />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-ink-950 to-transparent" />
          <span className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-ink-950/85 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
            {s.card === "booking" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70" /> : <LiveDot />} {status}
          </span>
        </button>
      )}

      <div className="p-4">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
              {kicker} · {load.referenceNumber}
            </p>
            <p className="shrink-0 text-sm font-semibold tabular">{s.card === "booking" ? formatCurrency(load.bookedRate ?? load.targetRate) : s.drive}</p>
          </div>
          <p className="mt-0.5 truncate text-xl font-semibold tracking-tight">{place}</p>
          {truckLabel && <p className="mt-0.5 truncate text-xs text-white/55">{truckLabel}{!showMap ? ` · ${status}` : ""}</p>}
        </button>

        <CompletionBar value={s.card === "booking" ? s.done : s.done / s.total} className="mt-3" />

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm leading-snug">
            <span className="text-white/50">Next </span>
            <span className="font-medium">{driver ? s.next.title : waitingOn(s, driverName)}</span>
            {s.next.owner === "ai" && <Loader2 className="ml-1.5 inline h-3.5 w-3.5 animate-spin text-white/50" />}
          </p>
          {action === "loaded" || action === "unloaded" ? (
            <PillButton onClick={() => onTripStep(load.id, action)}>{action === "loaded" ? "I'm loaded" : "I'm unloaded"}</PillButton>
          ) : action === "upload_bol" || action === "upload_pod" ? (
            <DocumentSlot label={`Photo of ${docName}`} onFile={(f) => onUpload(load.id, action === "upload_bol" ? "bol" : "pod", f)} />
          ) : action === "pretrip" ? (
            <InspectionLink kind="pre_trip">Start</InspectionLink>
          ) : null}
        </div>

        {s.arrived && (
          <div className="mt-2.5">
            <DockTimer load={load} brokerName={props.brokerName} compact />
          </div>
        )}

        {load.liveCall && (
          <div className="mt-3">
            <BrokerCallRow load={load} brokerName={props.brokerName ?? "the broker"} contactName={contact} onCall={() => {}} compact />
          </div>
        )}

        {(action === "arrive" || action === "start" || action === "complete") && (
          <div className="mt-3">
            <SwipeToConfirm
              label={
                action === "arrive" ? "Swipe when you arrive" : action === "start" ? "Swipe to start the trip" : "Swipe to complete delivery"
              }
              disabledLabel={action === "arrive" ? undefined : lockReason(s, docName, s.card === "pickup" && needsPreTrip)}
              onConfirm={() => onConfirm(load.id)}
            />
          </div>
        )}

        <button type="button" onClick={onOpen} className="mt-3 flex w-full items-center justify-center gap-1 rounded-full py-1.5 text-xs font-medium text-white/60 hover:text-white">
          <ChevronUp className="h-3.5 w-3.5" /> Full details
        </button>
      </div>
    </CardShell>
  );
}

/** Uber-style sheet: slides up over the page on a phone, a centered panel on a larger screen. */
export function TripSheet({ open, onClose, title, wide, children }: { open: boolean; onClose: () => void; title: string; wide?: boolean; children: React.ReactNode }) {
  useEscapeKey(onClose, open);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative flex max-h-[94dvh] w-full animate-sheet-up flex-col overflow-hidden rounded-t-3xl bg-ink-900 sm:max-h-[90vh] sm:rounded-3xl",
          wide ? "sm:max-w-xl" : "sm:max-w-md",
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 text-white">
          <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/25 sm:hidden" />
          <p className="mt-2 text-sm font-semibold">{title}</p>
          <button type="button" onClick={onClose} autoFocus aria-label="Close details" className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/15">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-3 pb-6">{children}</div>
      </div>
    </div>
  );
}

/** Everything behind the compact card: the full phase card with every step, what the AI has done on this load,
 *  the load's facts and its paperwork. */
export function TripDetails({
  autoPick,
  onAutoPick,
  loadHref,
  ...props
}: DriverTripCardProps & { autoPick: boolean; onAutoPick: (on: boolean) => void; loadHref: string }) {
  const { load, brokerName } = props;
  const now = useNow();
  const events = useStore((s) => s.activity).filter((e) => e.loadId === load.id);
  const rate = load.bookedRate ?? load.targetRate;
  const activity = [...events, ...(events.length < 3 ? loadHistory(load, brokerName ?? "the broker", rate) : [])]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 10);

  return (
    <>
      <DriverTripCard {...props} />

      <Section title="Next load">
        <AutoPickRow on={autoPick} onChange={onAutoPick} />
      </Section>

      <Section title="What the AI is doing" icon={<Sparkles className="h-3.5 w-3.5" />}>
        {activity.length === 0 ? (
          <p className="text-sm text-white/50">Nothing logged yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {activity.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", e.severity === "success" ? "bg-emerald-400" : e.severity === "warning" ? "bg-amber-400" : "bg-white/40")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{e.message}</p>
                  <p className="text-xs text-white/50">{e.detail}</p>
                </div>
                <span className="shrink-0 text-[11px] text-white/40">{now ? timeAgo(e.timestamp, now) : ""}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Load">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Fact label="Broker" value={brokerName ?? "—"} />
          <Fact label="Reference" value={load.referenceNumber} />
          <Fact label="Total rate" value={formatCurrency(rate)} />
          <Fact label="Est. net" value={formatCurrency(load.netProfit ?? 0)} />
          <Fact label="Loaded miles" value={`${load.lane.miles} mi`} />
          <Fact label="Empty miles" value={`${load.deadheadMiles} mi`} />
          <Fact label="Equipment" value={load.equipmentType} />
          <Fact label="Weight" value={`${load.weight.toLocaleString()} lbs`} />
          <Fact label="Pickup" value={load.pickupWindow} />
          <Fact label="Delivery" value={load.deliveryWindow} />
        </dl>
      </Section>

      <Section title="Documents">
        {load.documents.length === 0 ? (
          <p className="text-sm text-white/50">No documents yet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {load.documents.map((d) => (
              <li key={d.id} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <FileText className="h-4 w-4 text-white/60" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{d.name}</p>
                  <p className="text-xs text-white/50">
                    {d.status === "pending" ? "AI is reading it…" : d.aiNote ? `AI checked: ${d.aiNote}` : d.uploadedBy === "driver" ? "Uploaded by driver" : "Generated by AI"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Link href={loadHref} className="flex items-center justify-center gap-1 rounded-full bg-white/10 py-3 text-sm font-medium text-white hover:bg-white/15">
        Open the full load page <ChevronRight className="h-4 w-4" />
      </Link>
    </>
  );
}

type LogItem = { id: string; timestamp: string; message: string; detail: string; severity?: "info" | "success" | "warning" | "critical" };

/** What the AI did on a load before this session started logging live events — rebuilt from the load's own
 *  record (the negotiation thread, broker calls, filed paperwork) so the log is never empty. */
function loadHistory(load: DriverTripCardProps["load"], broker: string, rate: number): LogItem[] {
  const items: LogItem[] = [
    { id: `${load.id}-found`, timestamp: load.createdAt, message: "AI found and scored this load", detail: `${load.score} match · via ${load.source}`, severity: "info" },
  ];
  if (load.messages.length) {
    items.push({
      id: `${load.id}-neg`,
      timestamp: load.messages[load.messages.length - 1].timestamp,
      message: `AI negotiated with ${broker}`,
      detail: `${load.messages.length} message${load.messages.length === 1 ? "" : "s"} · ${formatCurrency(rate)}`,
      severity: "info",
    });
  }
  for (const c of load.calls) {
    items.push({ id: c.id, timestamp: c.startedAt, message: `AI called ${broker}`, detail: c.outcome ?? "Call logged", severity: "info" });
  }
  for (const d of load.documents) {
    items.push({ id: d.id, timestamp: d.generatedAt, message: `${d.name} filed`, detail: d.aiNote ?? (d.uploadedBy === "driver" ? "Uploaded by driver" : "Generated by AI"), severity: "success" });
  }
  return items;
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-ink-950 p-5 text-white">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-white/45">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

