"use client";

import { Sheet } from "@/components/ui/sheet";
import Link from "next/link";
import { ChevronRight, ChevronUp, FileText, Fuel, Loader2, Sparkles } from "lucide-react";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { cityCoords, pickupLegStart, type LatLng } from "@/lib/trip-geo";
import { tripState } from "@/lib/trip-state";
import { CARD_DISCOUNT, planFuel } from "@/lib/fuel";
import { MOVE_LABEL } from "@/lib/run-types";
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
import { Lane } from "@/components/ui/lane";
import { StatusMark } from "@/components/ui/mark";
import { QuickPreTrip } from "@/components/driver/quick-pretrip";
import { usePayView } from "@/lib/pay-view";
import { driveWords, nextWords, useTripText } from "@/lib/lang/trip-ui";

/** The small, always-current trip card — Uber's collapsed sheet: where, when, how far along, and the one next
 *  step (with its button when it's the driver's to take). Tap it for everything else. */
export function TripCompactCard({
  onOpen,
  showMap = true,
  truckLabel,
  ...props
}: DriverTripCardProps & { onOpen: () => void; showMap?: boolean; truckLabel?: string }) {
  const { load, needsPreTrip, viewer = "driver", driverName, onConfirm, onTripStep, onUpload } = props;
  const pay = usePayView(viewer);
  const w = useTripText(viewer);
  const now = useNow();
  const s = tripState(load, now, needsPreTrip);
  const drive = driveWords(w, s);
  const driver = viewer === "driver";
  const origin = `${load.lane.origin}, ${load.lane.originState}`;
  const destination = `${load.lane.destination}, ${load.lane.destState}`;
  const originPt = cityCoords(load.lane.origin, load.lane.originState);
  const destPt = cityCoords(load.lane.destination, load.lane.destState);

  // In town, the driver counts the day in moves, not loads.
  const movesToday = useStore((st) => {
    if (!load.lane.moveKind) return 0;
    const today = new Date().toDateString();
    return st.loads.filter((l) => l.truckId === load.truckId && l.stage === "delivered" && l.lane.moveKind && new Date(l.updatedAt).toDateString() === today).length;
  });
  const phase = s.card === "booking" ? w.booking : s.card === "pickup" ? w.pickup : w.delivery;
  const kicker = load.lane.moveKind ? w.compact.move(movesToday + 1, MOVE_LABEL[load.lane.moveKind]) : phase;
  const place = s.card === "booking" ? <Lane from={load.lane.origin} to={load.lane.destination} /> : s.card === "pickup" ? origin : destination;
  const status = s.card === "booking" ? w.booking : s.arrived ? (s.card === "pickup" ? w.atShipper : w.atReceiver) : s.card === "pickup" ? w.toPickup : w.toDelivery;
  const mapFrom: LatLng | undefined = s.card === "pickup" ? pickupLegStart(load, props.truckCity, props.truckState) : originPt;
  const mapTo: LatLng | undefined = s.card === "pickup" ? originPt : destPt;
  const progress = s.card === "booking" ? 0 : s.arrived ? 1 : s.legP;
  const docName = s.card === "pickup" ? "BOL" : "POD";
  const action = driver ? s.next.action : null;
  const contact = useStore((st) => st.brokers.find((b) => b.id === load.brokerId)?.contact);

  return (
    <CardShell className="p-0">
      {showMap && mapFrom && mapTo && (
        <button type="button" onClick={onOpen} aria-label={w.compact.openDetails} className="relative isolate block h-28 w-full overflow-hidden text-left">
          <TripMap from={mapFrom} to={mapTo} laneKey={s.card === "pickup" ? undefined : `${origin}|${destination}`} progress={progress} showTruck={s.card !== "booking" && s.located} compact />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-ink-950 to-transparent" />
          <span className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-ink-950/85 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
            {s.card === "booking" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70" /> : <LiveDot />} {status}
          </span>
        </button>
      )}

      <div className="p-4">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
              {kicker}{load.lane.moveKind ? ` · ${phase}` : ` · ${load.referenceNumber}`}
            </p>
            <p className="shrink-0 text-sm font-semibold tabular">{s.card === "booking" ? formatCurrency(pay.sees ? load.bookedRate ?? load.targetRate : pay.yourPay(load)) : drive}</p>
          </div>
          <p className="mt-0.5 truncate text-xl font-semibold tracking-tight">{place}</p>
          {truckLabel && <p className="mt-0.5 truncate text-xs text-white/55">{truckLabel}{!showMap ? ` · ${status}` : ""}</p>}
        </button>

        <CompletionBar value={s.card === "booking" ? s.done : s.done / s.total} className="mt-3" />

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm leading-snug">
            <span className="text-white/50">{w.compact.next} </span>
            <span className="font-medium">{driver ? nextWords(w, s) : waitingOn(s, driverName)}</span>
            {s.next.owner === "ai" && <Loader2 className="ml-1.5 inline h-3.5 w-3.5 animate-spin text-white/50" />}
          </p>
          {action === "loaded" || action === "unloaded" ? (
            <PillButton onClick={() => onTripStep(load.id, action)}>{action === "loaded" ? w.imLoaded : w.imUnloaded}</PillButton>
          ) : action === "upload_bol" || action === "upload_pod" ? (
            <DocumentSlot label={w.photoOf(docName)} pagesKey={`${load.id}:${action === "upload_bol" ? "bol" : "pod"}`} onFile={(f) => onUpload(load.id, action === "upload_bol" ? "bol" : "pod", f)} />
          ) : action === "pretrip" ? (
            <div className="flex flex-wrap items-center gap-2">
              <InspectionLink kind="pre_trip">{w.start}</InspectionLink>
              <QuickPreTrip />
            </div>
          ) : null}
        </div>

        {s.arrived && (
          <div className="mt-2.5">
            <DockTimer load={load} brokerName={props.brokerName} compact viewer={viewer} />
          </div>
        )}

        {load.liveCall && (
          <div className="mt-3">
            <BrokerCallRow load={load} brokerName={props.brokerName ?? w.theBroker} contactName={contact} onCall={() => {}} compact />
          </div>
        )}

        {(action === "arrive" || action === "start" || action === "complete") && (
          <div className="mt-3">
            <SwipeToConfirm
              label={
                action === "arrive" ? w.swipeArrive : action === "start" ? w.swipeStart : w.swipeComplete
              }
              disabledLabel={action === "arrive" ? undefined : lockReason(s, docName, s.card === "pickup" && needsPreTrip, w)}
              onConfirm={() => onConfirm(load.id)}
              chime={action === "complete" ? "delivered" : undefined}
            />
          </div>
        )}

        <button type="button" onClick={onOpen} className="mt-3 flex w-full items-center justify-center gap-1 rounded-full py-1.5 text-xs font-medium text-white/60 hover:text-white">
          <ChevronUp className="h-3.5 w-3.5" /> {w.compact.fullDetails}
        </button>
      </div>
    </CardShell>
  );
}

/** Uber-style sheet: slides up over the page on a phone, a centered panel on a larger screen. */
/**
 * The driver's Home opens on the trip, the way Uber's does: a big live map of where they're headed, with the status
 * and time left on top. The trip card sits on a sheet under it.
 */
export function TripHeroMap(props: DriverTripCardProps) {
  const { load, needsPreTrip } = props;
  const w = useTripText(props.viewer ?? "driver");
  const now = useNow();
  const s = tripState(load, now, needsPreTrip);
  const origin = `${load.lane.origin}, ${load.lane.originState}`;
  const destination = `${load.lane.destination}, ${load.lane.destState}`;
  const originPt = cityCoords(load.lane.origin, load.lane.originState);
  const destPt = cityCoords(load.lane.destination, load.lane.destState);
  const from: LatLng | undefined = s.card === "pickup" ? pickupLegStart(load, props.truckCity, props.truckState) : originPt;
  const to: LatLng | undefined = s.card === "pickup" ? originPt : destPt;
  const status = s.card === "booking" ? w.booking : s.arrived ? (s.card === "pickup" ? w.atShipper : w.atReceiver) : s.card === "pickup" ? w.toPickup : w.toDelivery;
  if (!from || !to) return null;
  return (
    <div className="theme-ink relative isolate h-[44vh] min-h-64 w-full overflow-hidden bg-ink-950 text-white" aria-label={`${status}. ${s.card === "pickup" ? origin : destination}`} role="img">
      <TripMap from={from} to={to} laneKey={s.card === "pickup" ? undefined : `${origin}|${destination}`} progress={s.card === "booking" ? 0 : s.arrived ? 1 : s.legP} showTruck={s.card !== "booking" && s.located} />
      <span className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-ink-950/70 to-transparent" />
      <div className="absolute inset-x-4 top-3 z-10 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 rounded-full bg-ink-950/80 px-3 py-1.5 text-xs font-semibold backdrop-blur-md">
          {s.card === "booking" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70" /> : <LiveDot />} {status}
        </span>
        {s.card !== "booking" && <span className="rounded-full bg-ink-950/80 px-3 py-1.5 text-xs font-semibold tabular backdrop-blur-md">{driveWords(w, s)}</span>}
      </div>
    </div>
  );
}

export function TripSheet({ open, onClose, title, wide, children }: { open: boolean; onClose: () => void; title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} tone="ink" size={wide ? "lg" : "md"}>
      <div className="-mx-2 flex flex-col gap-3">{children}</div>
    </Sheet>
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
  const pay = usePayView(props.viewer ?? "driver");
  const w = useTripText(props.viewer ?? "driver");
  const activity = [...events, ...(events.length < 3 ? loadHistory(load, brokerName ?? "the broker", pay.sees ? rate : null) : [])]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 10);

  return (
    <>
      <DriverTripCard {...props} />

      <Section title={w.details.nextLoad}>
        <AutoPickRow on={autoPick} onChange={onAutoPick} viewer={props.viewer ?? "driver"} />
      </Section>

      <Section title={w.details.doing} icon={<Sparkles className="h-3.5 w-3.5" />}>
        {activity.length === 0 ? (
          <p className="text-sm text-white/50">{w.details.nothing}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {activity.map((e) => (
              <li key={e.id} className="flex gap-3">
                {e.severity === "warning" ? <StatusMark kind="waiting" className="mt-1" /> : <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", e.severity === "success" ? "bg-[var(--dot-live)]" : "bg-white/40")} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{e.message}</p>
                  <p className="text-xs text-white/50">{e.detail}</p>
                </div>
                <span className="shrink-0 text-xs text-white/60">{now ? timeAgo(e.timestamp, now) : ""}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <FuelPlanSection load={load} viewer={props.viewer ?? "driver"} />

      <Section title={w.details.load}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Fact label={w.details.broker} value={brokerName ?? "—"} />
          <Fact label={w.details.reference} value={load.referenceNumber} />
          {pay.sees ? (
            <>
              <Fact label={w.details.totalRate} value={formatCurrency(rate)} />
              <Fact label={w.details.estNet} value={formatCurrency(load.netProfit ?? 0)} />
            </>
          ) : (
            <Fact label={w.details.yourPay} value={formatCurrency(pay.yourPay(load))} />
          )}
          <Fact label={w.details.loadedMiles} value={`${load.lane.miles} mi`} />
          <Fact label={w.details.emptyMiles} value={`${load.deadheadMiles} mi`} />
          <Fact label={w.details.equipment} value={load.equipmentType} />
          <Fact label={w.details.weight} value={`${load.weight.toLocaleString()} lbs`} />
          <Fact label={w.details.pickup} value={load.pickupWindow} />
          <Fact label={w.details.delivery} value={load.deliveryWindow} />
        </dl>
      </Section>

      <Section title={w.details.documents}>
        {load.documents.length === 0 ? (
          <p className="text-sm text-white/50">{w.details.noDocs}</p>
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
                    {d.status === "pending" ? w.photo.reading : d.aiNote ? w.photo.checked(d.aiNote) : d.uploadedBy === "driver" ? w.details.byDriver : w.details.byBackroute}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Link href={loadHref} className="flex items-center justify-center gap-1 rounded-full bg-white/10 py-3 text-sm font-medium text-white hover:bg-white/15">
        {w.details.openFull} <ChevronRight className="h-4 w-4" />
      </Link>
    </>
  );
}

/** Where to buy fuel on the loaded run — the driver still decides; the AI just says where it's cheapest. */
function FuelPlanSection({ load, viewer }: { load: DriverTripCardProps["load"]; viewer: "driver" | "carrier" }) {
  const now = useNow();
  const w = useTripText(viewer);
  const mpg = useStore((st) => st.trucks.find((t) => t.id === load.truckId)?.mpg ?? 6.5);
  // The prices behind it are sample numbers, so a real account doesn't get told where to fuel from them.
  const sample = useStore((st) => st.session.mode === "demo");
  const s = tripState(load, now, false);
  if (!sample || s.card === "booking" || load.stage === "at_delivery") return null;
  const milesDone = s.card === "delivery" ? Math.round(load.lane.miles * s.legP) : 0;
  const plan = planFuel(load, mpg, milesDone);
  if (!plan) return null;

  return (
    <Section title={w.fuel.title} icon={<Fuel className="h-3.5 w-3.5" />}>
      <p className="text-sm">{w.fuel.tank(plan.startPct, plan.milesLeft, plan.gallonsNeeded, mpg.toFixed(1))}</p>
      {plan.stops.length === 0 ? (
        <p className="mt-2 text-sm text-white/60">{w.fuel.noStop}</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2.5">
          {plan.stops.map((stop) => (
            <li key={`${stop.state}-${stop.milesAhead}`} className="flex items-start justify-between gap-3 rounded-2xl bg-white/5 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{stop.chain}, {stop.stateName}</p>
                <p className="text-xs text-white/55">{w.fuel.ahead(stop.milesAhead, stop.gallons)}</p>
              </div>
              <p className="shrink-0 text-right text-sm font-semibold tabular">
                ${stop.pricePerGal.toFixed(2)}
                <span className="block text-xs font-normal text-white/50">{w.fuel.withCard}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
      {plan.savings > 0 && <p className="mt-2 text-xs text-white/60">{w.fuel.savings(formatCurrency(plan.savings))}</p>}
      <p className="mt-2 text-xs leading-relaxed text-white/45">{w.fuel.note(Math.round(CARD_DISCOUNT * 100))}</p>
    </Section>
  );
}

type LogItem = { id: string; timestamp: string; message: string; detail: string; severity?: "info" | "success" | "warning" | "critical" };

/** What the AI did on a load before this session started logging live events — rebuilt from the load's own
 *  record (the negotiation thread, broker calls, filed paperwork) so the log is never empty. */
function loadHistory(load: DriverTripCardProps["load"], broker: string, rate: number | null): LogItem[] {
  const items: LogItem[] = [
    { id: `${load.id}-found`, timestamp: load.createdAt, message: "Found and checked by Backroute", detail: `${load.score} match · via ${load.source}`, severity: "info" },
  ];
  if (load.messages.length) {
    items.push({
      id: `${load.id}-neg`,
      timestamp: load.messages[load.messages.length - 1].timestamp,
      message: `Negotiated with ${broker}`,
      detail: `${load.messages.length} message${load.messages.length === 1 ? "" : "s"}${rate === null ? "" : ` · ${formatCurrency(rate)}`}`,
      severity: "info",
    });
  }
  for (const c of load.calls) {
    items.push({ id: c.id, timestamp: c.startedAt, message: `Called ${broker}`, detail: c.outcome ?? "Call logged", severity: "info" });
  }
  for (const d of load.documents) {
    items.push({ id: d.id, timestamp: d.generatedAt, message: `${d.name} filed`, detail: d.aiNote ?? (d.uploadedBy === "driver" ? "Uploaded by driver" : "Made by Backroute"), severity: "success" });
  }
  return items;
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="theme-ink rounded-3xl bg-ink-950 p-5 text-white">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/50">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-white/45">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

