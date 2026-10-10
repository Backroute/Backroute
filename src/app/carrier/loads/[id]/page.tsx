"use client";

import { useParams, useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, MapPin, MoreHorizontal, ArrowRightLeft, Ban, Camera, Fuel, Gauge, Percent, Phone, Route, ShieldAlert, TrendingUp, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadStagePill } from "@/components/shared/load-stage";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { BrokerTrustBadge } from "@/components/shared/broker-trust-badge";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { NegotiationComposer } from "@/components/shared/negotiation-composer";
import { NegotiationThread } from "@/components/shared/negotiation-thread";
import { CallTranscript } from "@/components/shared/call-transcript";
import { BrokerCallRow } from "@/components/shared/broker-call";
import { PaymentCard } from "@/components/shared/payment-card";
import { VoiceCallModal } from "@/components/shared/voice-call-modal";
import { RateConCard } from "@/components/shared/rate-con-card";
import { RateConReader } from "@/components/shared/rate-con-reader";
import { WhyCard } from "@/components/cloud/why-card";
import { TeachAi } from "@/components/cloud/teach-ai";
import { LoadTimeline } from "@/components/shared/load-timeline";
import { LiveDot } from "@/components/shared/live-dot";
import { StopsTimeline } from "@/components/shared/stops-timeline";
import { TripStepper } from "@/components/shared/trip-stepper";
import { Progress } from "@/components/ui/progress";
import { useLoad, useBrokerMap, useTruckMap, useDriverMap, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { aiDispatcherNote, isTransitStage } from "@/lib/load-status";
import type { Load } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { openFile } from "@/lib/cloud/files";
import { BookingCard } from "@/components/cloud/booking-card";
import type { Driver, LoadStage, Truck } from "@/lib/types";
import { ViewTransition } from "react";
import { BACK, cameFromInApp } from "@/lib/nav-direction";
import { ContactRow } from "@/components/shared/contact-row";
import { tonuFor } from "@/lib/tonu";
import { TimeAgo } from "@/components/shared/time-ago";
import { stopDates } from "@/lib/load-dates";
import { useNow } from "@/lib/hooks";
import { Lane } from "@/components/ui/lane";
import { hasSheet, LoadSheet } from "@/components/shared/load-sheet";
import { DispatchChecklist } from "@/components/shared/dispatch-checklist";
import { dispatchStops } from "@/lib/dispatch-checks";

/** Cancellable once rate is locked in; once in transit the freight is already moving, so that's a
 *  claim situation, not a cancellation. Dispatched/at_pickup carry a TONU fee since the truck already committed. */
const CANCELLABLE_STAGES: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup"];
const TONU_STAGES: LoadStage[] = ["dispatched", "at_pickup"];
/** Swappable up through at_pickup — once freight is actually moving with a truck, that's a mid-route
 *  problem (see incident reporting), not a reassignment. */
const REASSIGNABLE_STAGES: LoadStage[] = ["booked", "dispatched", "at_pickup"];

type Section = "sheet" | "why" | "deal" | "rateCon" | "docs" | "timeline" | "pay" | "rateProfit" | "expenses" | "assignment" | "stops";

/**
 * The page leads with what the load needs now. While it's being won, the broker talk and the money; once it's on a
 * truck, the trip and its papers (the deal is history by then); once delivered, getting paid.
 */
function sectionOrder(stage: LoadStage): { main: Section[]; side: Section[] } {
  if (stage === "delivered" || stage === "cancelled")
    return { main: ["docs", "rateCon", "deal", "why"], side: ["pay", "rateProfit", "expenses", "timeline", "assignment", "stops"] };
  if (isTransitStage(stage) || stage === "booked" || stage === "rate_confirmed")
    return { main: ["docs", "sheet", "stops", "rateCon", "deal", "why"], side: ["assignment", "timeline", "pay", "rateProfit", "expenses"] };
  return { main: ["why", "deal", "rateCon", "docs"], side: ["rateProfit", "expenses", "timeline", "pay", "assignment", "stops"] };
}

const CANCEL_REASONS = ["Broker cancelled the load", "Receiver refused / detention dispute", "Freight not ready at pickup", "Rate dispute", "Other"];
const DECLINE_REASONS = ["Broker won't move on rate", "Better option found elsewhere", "Lane no longer needed", "Other"];

/** Where the truck is and when it's due next, first thing on the page: what the owner opens a load to find out. */
function WhereNow({ load, truck, driverName }: { load: Load; truck?: Truck; driverName?: string }) {
  const now = useNow();
  if (!truck || !["dispatched", "at_pickup", "in_transit", "at_delivery", "booked", "rate_confirmed"].includes(load.stage)) return null;
  const heading = ["in_transit", "at_delivery"].includes(load.stage) ? "delivery" : "pickup";
  const when = now === null ? null : stopDates(load, now)[heading];
  const place = heading === "pickup" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`;
  const at = load.stage === "at_pickup" || load.stage === "at_delivery";
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-700">
      <MapPin className="h-3.5 w-3.5 text-ink-400" />
      <span>
        {truck.unitNumber}
        {driverName ? ` · ${driverName}` : ""} {at ? "is at the" : "is in"}{" "}
        <span className="font-medium text-ink-950">{at ? `${heading} dock` : truck.position?.description ?? `${truck.currentCity}, ${truck.currentState}`}</span>
        {truck.position && !at && (
          <span className="text-ink-400">
            {" "}
            (<TimeAgo iso={truck.position.at} />)
          </span>
        )}
      </span>
      {!at && (
        <span className="text-ink-500">
          · {heading === "pickup" ? "Pickup" : "Delivery"} {place}
          {when?.relative || when?.date ? `, ${when.relative ?? when.date}` : ""}
          {when?.time ? ` ${when.time}` : ""}
        </span>
      )}
      {load.late?.stop === heading && <span className="font-medium text-[var(--accent-danger)]">· Running late, about {load.late.eta}</span>}
    </p>
  );
}

/** Which document a stage is still waiting on — same source of truth the driver's confirm button
 *  reads from, so this card's pending rows can never disagree with what actually triggers capture. */
function pendingDocLabel(type: "bol" | "pod"): string {
  return type === "bol" ? "Bill of Lading (BOL)" : "Proof of Delivery (POD)";
}

export default function LoadDetailPage() {
  const params = useParams<{ id: string }>();
  const load = useLoad(params.id);
  const brokers = useBrokerMap();
  const trucks = useTruckMap();
  const drivers = useDriverMap();
  const carrierTrucks = useCarrierTrucks();
  const requestBetterRate = useStore((s) => s.actions.requestBetterRate);
  const sendNegotiationInstruction = useStore((s) => s.actions.sendNegotiationInstruction);
  const cancelLoad = useStore((s) => s.actions.cancelLoad);
  const declineLoad = useStore((s) => s.actions.declineLoad);
  const reassignTruck = useStore((s) => s.actions.reassignTruck);
  const startBrokerCall = useStore((s) => s.actions.startBrokerCall);
  const [calling, setCalling] = useState(false);
  // A real account: broker work is real email (BookingCard); the demo's simulated negotiation stays in the demo.
  const real = useStore((s) => s.session.mode !== "demo");
  const [cancelling, setCancelling] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [menu, setMenu] = useState(false);
  const tonuSetting = useStore((s) => s.settings.tonuFee);
  const router = useRouter();

  if (!load) {
    return (
      <div className="px-4 py-16 sm:px-8 text-center">
        <p className="text-sm text-ink-500">This load isn&apos;t in the current simulation window.</p>
        <Link href="/carrier/loads" className="mt-3 inline-block text-sm font-medium text-ink-950 underline">
          Back to loads
        </Link>
      </div>
    );
  }

  const broker = brokers.get(load.brokerId);
  const truck = load.truckId ? trucks.get(load.truckId) : undefined;
  const driver = truck?.driverId ? drivers.get(truck.driverId) : undefined;

  const why = (
    <>
      {real && <WhyCard load={load} />}
        {real && <TeachAi load={load} />}
    </>
  );
  const deal = (
    <>
      {real ? (
          <BookingCard load={load} broker={broker} />
        ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Negotiation</CardTitle>
              {broker && (
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-ink-500">{broker.company} · {broker.contact}</p>
                  <BrokerTrustBadge broker={broker} />
                </div>
              )}
            </div>
            {load.stage === "negotiating" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCalling(true)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-700 hover:border-ink-300"
                  aria-label="Call dispatch"
                >
                  <Phone className="h-4 w-4" />
                </button>
                <CounterOfferButton load={load} onSubmit={(amount) => requestBetterRate(load.id, "carrier", amount)} variant="outline" />
              </div>
            )}
          </CardHeader>
          <CardContent className="!pt-4">
            {(load.liveCall || (load.stage === "negotiating" && !load.calls.length)) && (
              <div className="theme-ink mb-4 rounded-2xl bg-ink-950 p-3 text-white">
                <BrokerCallRow load={load} brokerName={broker?.company ?? "the broker"} contactName={broker?.contact} onCall={() => startBrokerCall(load.id)} />
              </div>
            )}
            <NegotiationThread messages={load.messages} />
            {load.calls.length > 0 && (
              <div className="mt-4 flex flex-col gap-4">
                {load.calls.map((call) => (
                  <CallTranscript
                    key={call.id}
                    call={call}
                    brokerName={broker?.company}
                    title={call.transcript.some((l) => l.speaker === "driver" || l.speaker === "carrier") ? "Your call with dispatch" : "Voice Agent Call"}
                  />
                ))}
              </div>
            )}
            {load.stage === "negotiating" && (
              <div className="mt-4">
                <NegotiationComposer onSend={(text) => sendNegotiationInstruction(load.id, "carrier", text)} />
              </div>
            )}
          </CardContent>
        </Card>
        )}
    </>
  );
  const rateCon = (
    <>
      <RateConCard load={load} />
        <RateConReader load={load} broker={broker} />
    </>
  );
  const docs = (
    <>
      <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent className="!pt-3">
            {(() => {
              const step = STAGE_CONFIRM[load.stage];
              const pendingType = step?.doc && !load.documents.some((d) => d.type === step.doc) ? step.doc : null;
              if (load.documents.length === 0 && !pendingType) {
                return <p className="text-sm text-ink-400">No documents generated yet.</p>;
              }
              return (
                <div className="flex flex-col divide-y divide-line">
                  {load.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                          <FileText className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-ink-900">{doc.name}</p>
                          <p className="text-xs text-ink-400">{doc.uploadedBy === "driver" ? "Uploaded by driver · " : ""}{formatDateTime(doc.generatedAt)}</p>
                          {doc.aiNote && <p className={`mt-0.5 text-xs ${doc.flagged || doc.status === "failed" ? "text-[var(--accent-warn)]" : "text-ink-500"}`}>Checked: {doc.aiNote}</p>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {doc.fileId && (
                          <Button size="sm" variant="ghost" onClick={() => void openFile(doc.fileId!)}>
                            Open
                          </Button>
                        )}
                        <Badge tone={doc.status === "verified" && !doc.flagged ? "success" : "warning"}>{doc.flagged ? "check it" : doc.status}</Badge>
                      </div>
                    </div>
                  ))}
                  {pendingType && (
                    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-50 text-ink-400">
                          <Camera className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-ink-700">{pendingDocLabel(pendingType)}</p>
                          <p className="text-xs text-ink-400">Captured once the driver confirms {pendingType === "bol" ? "loaded" : "delivered"}.</p>
                        </div>
                      </div>
                      <Badge tone="neutral">pending</Badge>
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
    </>
  );
  const timeline = (
    <>
      <LoadTimeline load={load} brokerName={broker?.company} driverName={driver?.name} />
    </>
  );
  const pay = (
    <>
      <PaymentCard load={load} />
    </>
  );
  const rateProfit = (
    <>
      <Card>
          <CardHeader>
            <CardTitle>Rate & profit</CardTitle>
          </CardHeader>
          <CardContent className="!pt-3">
            <div className="flex flex-col gap-3.5">
              <Row label="Listed rate" value={formatCurrency(load.listedRate)} />
              <Row label="Target rate" value={formatCurrency(load.targetRate)} />
              <Row label="Booked rate" value={load.bookedRate ? formatCurrency(load.bookedRate) : "Pending"} strong />
              <Row
                label={load.bookedRate ? "Net profit" : "Est. net profit"}
                value={load.netProfit ? formatCurrency(load.netProfit) : "Projecting…"}
                tone={load.netProfit ? (load.netProfit > 0 ? "success" : "danger") : undefined}
                strong
              />
              <Row label="Per mile" value={load.rpm ? `$${load.rpm.toFixed(2)}` : "—"} />
            </div>
          </CardContent>
        </Card>
    </>
  );
  const expenses = (
    <>
      <Card>
          <CardHeader>
            <CardTitle>Real-time expenses</CardTitle>
          </CardHeader>
          <CardContent className="!pt-3">
            <div className="flex flex-col gap-3.5">
              <IconRow icon={Route} label="Distance" value={`${load.lane.miles} mi`} />
              <IconRow icon={Gauge} label="Empty miles" value={`${load.deadheadMiles} mi`} />
              <IconRow icon={Fuel} label="Fuel cost" value={formatCurrency(load.fuelCost)} />
              <IconRow icon={TrendingUp} label="Empty-mile cost" value={formatCurrency(load.deadheadCost)} />
              <IconRow icon={TrendingUp} label="Tolls" value={formatCurrency(load.tollCost)} />
              <IconRow icon={Percent} label="Backroute commission (2%)" value={formatCurrency(load.commission)} />
              <div className="border-t border-line pt-3.5">
                <Row
                  label="Total expenses"
                  value={formatCurrency(load.fuelCost + load.tollCost + load.deadheadCost + load.commission)}
                  strong
                />
              </div>
            </div>
          </CardContent>
        </Card>
    </>
  );
  const assignment = (
    <>
      {truck && (
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
              {REASSIGNABLE_STAGES.includes(load.stage) && !reassigning && (
                <button
                  onClick={() => setReassigning(true)}
                  className="flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-950"
                >
                  <ArrowRightLeft className="h-3 w-3" /> Reassign
                </button>
              )}
            </CardHeader>
            <CardContent className="!pt-3">
              <Row label="Truck" value={truck.unitNumber} />
              <div className="mt-3.5">
                <Row label="Driver" value={driver?.name ?? "Unassigned"} />
              </div>
              <div className="mt-3.5">
                <Row label="Pickup" value={load.pickupWindow} />
              </div>
              <DockAddresses load={load} />
              {driver && ["booked", "rate_confirmed", "dispatched"].includes(load.stage) && <DispatchChecklist load={load} driver={driver} className="mt-3.5" />}
              {reassigning && (
                <ReassignForm
                  load={load}
                  currentTruckId={truck.id}
                  trucks={carrierTrucks}
                  drivers={drivers}
                  onCancel={() => setReassigning(false)}
                  onConfirm={(newTruckId) => {
                    reassignTruck(load.id, newTruckId);
                    setReassigning(false);
                  }}
                />
              )}
            </CardContent>
          </Card>
        )}
    </>
  );
  const stops = (
    <>
      {load.stops && load.stops.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Stops</CardTitle>
            </CardHeader>
            <CardContent className="!pt-3">
              <StopsTimeline load={load} />
            </CardContent>
          </Card>
        )}
    </>
  );
  const sheet = hasSheet(load) ? <LoadSheet load={load} className="bg-white" /> : null;
  const sections = { sheet, why, deal, rateCon, docs, timeline, pay, rateProfit, expenses, assignment, stops };
  const layout = sectionOrder(load.stage);

  return (
    <div>
      <ViewTransition name={`load-${load.id}`} share="morph" default="none">
      <div className="border-b border-line bg-white/70 px-4 py-6 sm:px-8 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (cameFromInApp() ? router.back() : router.push("/carrier/loads", { transitionTypes: BACK }))}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-950"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <LiveDot label={aiDispatcherNote(load.stage)} />
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-ink-950">
              <Lane from={`${load.lane.origin}, ${load.lane.originState}`} to={`${load.lane.destination}, ${load.lane.destState}`} />
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {load.referenceNumber} · {load.equipmentType} · {load.weight.toLocaleString()} lbs · Sourced from {load.source}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LoadScoreBadge score={load.score} size="xl" />
            <LoadStagePill stage={load.stage} className="!text-xs !px-3 !py-1.5" />
          </div>
        </div>
        <WhereNow load={load} truck={truck} driverName={driver?.name} />
        <ContactRow driver={driver} broker={broker} className="mt-3" />
        {load.stage !== "cancelled" && (
          <div className="mt-4">
            {isTransitStage(load.stage) ? <TripStepper stage={load.stage} /> : <Progress value={load.progressPct} />}
          </div>
        )}
        {load.aiPaused && (
          <p className="mt-4 flex items-center gap-1.5 rounded-xl bg-warn-soft px-3.5 py-2.5 text-xs font-medium text-[var(--accent-warn)]">
            <ShieldAlert className="h-3.5 w-3.5" /> Backroute support has paused this load while they take a look.
          </p>
        )}
        {load.stage === "declined" && load.cancellationReason && (
          <div className="mt-4 rounded-xl bg-ink-100 px-3.5 py-2.5 text-xs font-medium text-ink-500">
            <p className="flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" /> Walked away: {load.cancellationReason}</p>
          </div>
        )}
        {load.stage === "cancelled" && (
          <div className="mt-4 rounded-xl bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-[var(--accent-danger)]">
            <p className="flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" /> Cancelled: {load.cancellationReason}</p>
            {load.tonuFee && <p className="mt-1 text-[var(--accent-warn)]">TONU fee of {formatCurrency(load.tonuFee)} invoiced to the broker.</p>}
          </div>
        )}
        {(CANCELLABLE_STAGES.includes(load.stage) || load.stage === "negotiating") && !cancelling && !declining && (
          <div className="relative mt-3">
            <button
              type="button"
              aria-expanded={menu}
              aria-label="More for this load"
              onClick={() => setMenu((v) => !v)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-950"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menu && (
              <div className="absolute left-0 top-9 z-20 min-w-56 rounded-2xl border border-line bg-white p-1.5 shadow-lg" role="menu">
                {CANCELLABLE_STAGES.includes(load.stage) && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), setCancelling(true))} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--accent-danger)] hover:bg-ink-50">
                    <Ban className="h-3.5 w-3.5" /> Cancel load…
                  </button>
                )}
                {load.stage === "negotiating" && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), setDeclining(true))} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-ink-800 hover:bg-ink-50">
                    <Ban className="h-3.5 w-3.5" /> Walk away from negotiation…
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {CANCELLABLE_STAGES.includes(load.stage) && cancelling && (
          <div className="mt-4">
            {cancelling ? (
              <CancelForm
                stage={load.stage}
                tonu={tonuFor(load, tonuSetting)}
                onCancel={() => setCancelling(false)}
                onConfirm={(reason) => {
                  cancelLoad(load.id, reason);
                  setCancelling(false);
                }}
              />
            ) : null}
          </div>
        )}
        {load.stage === "negotiating" && declining && (
          <div className="mt-4">
            {declining ? (
              <DeclineForm
                onCancel={() => setDeclining(false)}
                onConfirm={(reason) => {
                  declineLoad(load.id, reason);
                  setDeclining(false);
                }}
              />
            ) : null}
          </div>
        )}
      </div>
      </ViewTransition>

      <div className="grid gap-6 px-4 py-6 sm:px-8 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">{layout.main.map((k) => <Fragment key={k}>{sections[k]}</Fragment>)}</div>
        <div className="flex flex-col gap-6">{layout.side.map((k) => <Fragment key={k}>{sections[k]}</Fragment>)}</div>
      </div>

      {calling && broker && (
        <VoiceCallModal
          spec={{ kind: "negotiation", loadId: load.id, actor: "carrier", brokerName: broker.company, origin: load.lane.origin, dest: load.lane.destination }}
          onClose={() => setCalling(false)}
        />
      )}
    </div>
  );
}

function ReassignForm({
  load,
  currentTruckId,
  trucks,
  drivers,
  onCancel,
  onConfirm,
}: {
  load: Load;
  currentTruckId: string;
  trucks: Truck[];
  drivers: Map<string, Driver>;
  onCancel: () => void;
  onConfirm: (newTruckId: string) => void;
}) {
  const available = trucks.filter((t) => t.id !== currentTruckId && t.status === "available");
  const now = useNow();

  return (
    <div className="mt-3.5 flex flex-col gap-2 border-t border-line pt-3.5">
      {available.length === 0 ? (
        <p className="text-xs text-ink-400">No other trucks are free right now.</p>
      ) : (
        available.map((t) => {
          const d = t.driverId ? drivers.get(t.driverId) : undefined;
          return (
            <button
              key={t.id}
              onClick={() => onConfirm(t.id)}
              className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:border-ink-300"
            >
              <div>
                <p className="text-sm font-medium text-ink-900">{t.unitNumber}</p>
                <p className="text-xs text-ink-400">{d?.name ?? "Unassigned"} · {t.currentCity}, {t.currentState}</p>
                {d && now !== null && dispatchStops(load, d, now).map((c) => (
                  <p key={c.key} className="text-xs text-[var(--accent-danger)]">{c.label}: {c.detail}</p>
                ))}
              </div>
              <span className="text-xs font-medium text-ink-500">Move here</span>
            </button>
          );
        })
      )}
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

function CancelForm({ stage, tonu, onCancel, onConfirm }: { stage: LoadStage; tonu: number; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const tonuApplies = TONU_STAGES.includes(stage);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-danger-soft/50 p-3.5">
      {tonuApplies && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--accent-warn)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Truck already {stage === "at_pickup" ? "at pickup" : "dispatched"}. A {formatCurrency(tonu)} TONU fee will be invoiced to the broker.
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs text-ink-500">
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900">
          {CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="danger" onClick={() => onConfirm(reason)}>Confirm cancellation</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Never mind</Button>
      </div>
    </div>
  );
}

function DeclineForm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(DECLINE_REASONS[0]);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-ink-50/60 p-3.5">
      <label className="flex flex-col gap-1 text-xs text-ink-500">
        Reason for walking away
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900">
          {DECLINE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="danger" onClick={() => onConfirm(reason)}>Walk away</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Never mind</Button>
      </div>
    </div>
  );
}

/** The docks' street addresses: where the driver's truck GPS goes. Fill one in when the rate con didn't have it. */
function DockAddresses({ load }: { load: Load }) {
  const setDockAddress = useStore((s) => s.actions.setDockAddress);
  const [editing, setEditing] = useState<"pickup" | "delivery" | null>(null);
  const [text, setText] = useState("");
  const stops = [
    { stop: "pickup" as const, label: "Pickup dock", address: load.pickupAddress ?? load.rateConReading?.shipperAddress ?? null },
    { stop: "delivery" as const, label: "Delivery dock", address: load.deliveryAddress ?? load.rateConReading?.receiverAddress ?? null },
  ];
  return (
    <div className="mt-3.5 flex flex-col gap-3.5">
      {stops.map((x) =>
        editing === x.stop ? (
          <form
            key={x.stop}
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setDockAddress(load.id, x.stop, text);
              setEditing(null);
            }}
          >
            <input autoFocus aria-label={`${x.label} street address`} className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-1.5 text-sm" placeholder="Street, city, state ZIP" value={text} onChange={(e) => setText(e.target.value)} />
            <Button size="sm" type="submit">Save</Button>
          </form>
        ) : (
          <div key={x.stop} className="flex items-start justify-between gap-3">
            <span className="text-xs text-ink-500">{x.label}</span>
            <button
              type="button"
              onClick={() => {
                setText(x.address ?? "");
                setEditing(x.stop);
              }}
              className={"text-right text-sm " + (x.address ? "font-medium text-ink-950" : "font-medium text-[var(--accent-warn)] underline")}
            >
              {x.address ?? "Add the street address"}
            </button>
          </div>
        ),
      )}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "success" | "danger" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-500">{label}</span>
      <span
        className={
          "tabular text-sm " +
          (strong ? "font-semibold " : "font-medium ") +
          (tone === "success" ? "text-ink-950" : tone === "danger" ? "text-[var(--accent-danger)]" : "text-ink-950")
        }
      >
        {value}
      </span>
    </div>
  );
}

function IconRow({ icon: Icon, label, value }: { icon: typeof Route; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs text-ink-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <span className="tabular text-sm font-medium text-ink-950">{value}</span>
    </div>
  );
}
