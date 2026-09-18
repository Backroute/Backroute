"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera, Fuel, Gauge, Percent, Route, ShieldAlert, TrendingUp, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadStagePill } from "@/components/shared/load-stage";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { BrokerTrustBadge } from "@/components/shared/broker-trust-badge";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { NegotiationComposer } from "@/components/shared/negotiation-composer";
import { NegotiationThread } from "@/components/shared/negotiation-thread";
import { CallTranscript } from "@/components/shared/call-transcript";
import { LiveDot } from "@/components/shared/live-dot";
import { TripStepper } from "@/components/shared/trip-stepper";
import { Progress } from "@/components/ui/progress";
import { useLoad, useBrokerMap, useTruckMap, useDriverMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { aiDispatcherNote, isTransitStage } from "@/lib/load-status";
import { formatCurrency, formatDateTime } from "@/lib/utils";

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
  const requestBetterRate = useStore((s) => s.actions.requestBetterRate);
  const sendNegotiationInstruction = useStore((s) => s.actions.sendNegotiationInstruction);

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
        <div className="mt-4">
          {isTransitStage(load.stage) ? <TripStepper stage={load.stage} /> : <Progress value={load.progressPct} />}
        </div>
        {load.aiPaused && (
          <p className="mt-4 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-[var(--accent-warn)]">
            <ShieldAlert className="h-3.5 w-3.5" /> Backroute support has paused the AI on this load while they take a look.
          </p>
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
                <CounterOfferButton load={load} onSubmit={(amount) => requestBetterRate(load.id, "carrier", amount)} variant="outline" />
              )}
            </CardHeader>
            <CardContent className="!pt-4">
              <NegotiationThread messages={load.messages} />
              {load.calls.length > 0 && (
                <div className="mt-4 flex flex-col gap-4">
                  {load.calls.map((call) => (
                    <CallTranscript key={call.id} call={call} />
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
                            <p className="text-xs text-ink-400">{formatDateTime(doc.generatedAt)}</p>
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
                  label={load.bookedRate ? "Net profit (after our 2%)" : "Est. net profit"}
                  value={load.netProfit ? formatCurrency(load.netProfit) : "Projecting…"}
                  tone={load.netProfit ? (load.netProfit > 0 ? "success" : "danger") : undefined}
                  strong
                />
                <Row label="Rate / mile" value={load.rpm ? `$${load.rpm.toFixed(2)}` : "—"} />
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
                <IconRow icon={Gauge} label="Deadhead" value={`${load.deadheadMiles} mi`} />
                <IconRow icon={Fuel} label="Fuel cost" value={formatCurrency(load.fuelCost)} />
                <IconRow icon={TrendingUp} label="Deadhead cost" value={formatCurrency(load.deadheadCost)} />
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
              </CardHeader>
              <CardContent className="!pt-3">
                <Row label="Truck" value={truck.unitNumber} />
                <div className="mt-3.5">
                  <Row label="Driver" value={driver?.name ?? "Unassigned"} />
                </div>
                <div className="mt-3.5">
                  <Row label="Pickup" value={load.pickupWindow} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
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
