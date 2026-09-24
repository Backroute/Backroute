"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Ban, Camera, Fuel, Gauge, Percent, Phone, Route, ShieldAlert, TrendingUp, FileText } from "lucide-react";
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
import { LiveDot } from "@/components/shared/live-dot";
import { StopsTimeline } from "@/components/shared/stops-timeline";
import { TripStepper } from "@/components/shared/trip-stepper";
import { Progress } from "@/components/ui/progress";
import { useLoad, useBrokerMap, useTruckMap, useDriverMap, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { aiDispatcherNote, isTransitStage } from "@/lib/load-status";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Driver, LoadStage, Truck } from "@/lib/types";

/** Cancellable once rate is locked in; once in transit the freight is already moving, so that's a
 *  claim situation, not a cancellation. Dispatched/at_pickup carry a TONU fee since the truck already committed. */
const CANCELLABLE_STAGES: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup"];
const TONU_STAGES: LoadStage[] = ["dispatched", "at_pickup"];
/** Swappable up through at_pickup — once freight is actually moving with a truck, that's a mid-route
 *  problem (see incident reporting), not a reassignment. */
const REASSIGNABLE_STAGES: LoadStage[] = ["booked", "dispatched", "at_pickup"];

const CANCEL_REASONS = ["Broker cancelled the load", "Receiver refused / detention dispute", "Freight not ready at pickup", "Rate dispute", "Other"];
const DECLINE_REASONS = ["Broker won't move on rate", "Better option found elsewhere", "Lane no longer needed", "Other"];

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
  const [cancelling, setCancelling] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reassigning, setReassigning] = useState(false);

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

  return (
    <div>
      <div className="border-b border-line bg-white/70 px-4 py-6 sm:px-8 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <Link href="/carrier/loads" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-950">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to loads
          </Link>
          <LiveDot label={aiDispatcherNote(load.stage)} />
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-ink-950">
              {load.lane.origin}, {load.lane.originState} <span className="text-ink-300">→</span> {load.lane.destination}, {load.lane.destState}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {load.referenceNumber} · {load.equipmentType} · {load.weight.toLocaleString()} lbs · Sourced from {load.source}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LoadScoreBadge score={load.score} size="xl" />
            <div className="flex flex-col items-start gap-1.5">
              <LoadStagePill stage={load.stage} className="!text-xs !px-3 !py-1.5" />
              <Badge tone="info">AI confidence {load.aiConfidence}%</Badge>
            </div>
          </div>
        </div>
        {load.stage !== "cancelled" && (
          <div className="mt-4">
            {isTransitStage(load.stage) ? <TripStepper stage={load.stage} /> : <Progress value={load.progressPct} />}
          </div>
        )}
        {load.aiPaused && (
          <p className="mt-4 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-[var(--accent-warn)]">
            <ShieldAlert className="h-3.5 w-3.5" /> Backroute support has paused the AI on this load while they take a look.
          </p>
        )}
        {load.stage === "declined" && load.cancellationReason && (
          <div className="mt-4 rounded-xl bg-ink-100 px-3.5 py-2.5 text-xs font-medium text-ink-500">
            <p className="flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" /> Walked away: {load.cancellationReason}</p>
          </div>
        )}
        {load.stage === "cancelled" && (
          <div className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-xs font-medium text-[var(--accent-danger)]">
            <p className="flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" /> Cancelled: {load.cancellationReason}</p>
            {load.tonuFee && <p className="mt-1 text-[var(--accent-warn)]">TONU fee of {formatCurrency(load.tonuFee)} invoiced to the broker.</p>}
          </div>
        )}
        {CANCELLABLE_STAGES.includes(load.stage) && (
          <div className="mt-4">
            {cancelling ? (
              <CancelForm
                stage={load.stage}
                onCancel={() => setCancelling(false)}
                onConfirm={(reason) => {
                  cancelLoad(load.id, reason);
                  setCancelling(false);
                }}
              />
            ) : (
              <Button size="sm" variant="danger" onClick={() => setCancelling(true)}>
                <Ban className="h-3.5 w-3.5" /> Cancel load
              </Button>
            )}
          </div>
        )}
        {load.stage === "negotiating" && (
          <div className="mt-4">
            {declining ? (
              <DeclineForm
                onCancel={() => setDeclining(false)}
                onConfirm={(reason) => {
                  declineLoad(load.id, reason);
                  setDeclining(false);
                }}
              />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setDeclining(true)}>
                <Ban className="h-3.5 w-3.5" /> Walk away from negotiation
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 px-4 py-6 sm:px-8 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
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
                    aria-label="Call AI Dispatcher"
                  >
                    <Phone className="h-4 w-4" />
                  </button>
                  <CounterOfferButton load={load} onSubmit={(amount) => requestBetterRate(load.id, "carrier", amount)} variant="outline" />
                </div>
              )}
            </CardHeader>
            <CardContent className="!pt-4">
              {(load.liveCall || (load.stage === "negotiating" && !load.calls.length)) && (
                <div className="mb-4 rounded-2xl bg-ink-950 p-3 text-white">
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
                      title={call.transcript.some((l) => l.speaker === "driver" || l.speaker === "carrier") ? "Your call with AI Dispatcher" : "Voice Agent Call"}
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

          <RateConCard load={load} />
          <RateConReader load={load} broker={broker} />

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
                            {doc.aiNote && <p className="mt-0.5 text-xs text-[var(--accent-live)]">AI checked: {doc.aiNote}</p>}
                          </div>
                        </div>
                        <Badge tone={doc.status === "verified" ? "success" : "warning"}>{doc.status}</Badge>
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
        </div>

        <div className="flex flex-col gap-6">
          <PaymentCard load={load} />
          <Card>
            <CardHeader>
              <CardTitle>Rate & profit</CardTitle>
            </CardHeader>
            <CardContent className="!pt-3">
              <div className="flex flex-col gap-3.5">
                <Row label="Listed rate" value={formatCurrency(load.listedRate)} />
                <Row label="AI target rate" value={formatCurrency(load.targetRate)} />
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
                {reassigning && (
                  <ReassignForm
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
        </div>
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
  currentTruckId,
  trucks,
  drivers,
  onCancel,
  onConfirm,
}: {
  currentTruckId: string;
  trucks: Truck[];
  drivers: Map<string, Driver>;
  onCancel: () => void;
  onConfirm: (newTruckId: string) => void;
}) {
  const available = trucks.filter((t) => t.id !== currentTruckId && t.status === "available");

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

function CancelForm({ stage, onCancel, onConfirm }: { stage: LoadStage; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const tonuApplies = TONU_STAGES.includes(stage);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--accent-danger)]/30 bg-red-50/50 p-3.5">
      {tonuApplies && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--accent-warn)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Truck already {stage === "at_pickup" ? "at pickup" : "dispatched"}. A {formatCurrency(250)} TONU fee will be invoiced to the broker.
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

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "success" | "danger" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-500">{label}</span>
      <span
        className={
          "tabular text-sm " +
          (strong ? "font-semibold " : "font-medium ") +
          (tone === "success" ? "text-[var(--accent-live)]" : tone === "danger" ? "text-[var(--accent-danger)]" : "text-ink-950")
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
