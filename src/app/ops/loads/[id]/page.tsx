"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Camera, Fuel, Gauge, Pause, Percent, Play, Route, ShieldAlert, TrendingUp, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadStagePill } from "@/components/shared/load-stage";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { NegotiationThread } from "@/components/shared/negotiation-thread";
import { CallTranscript } from "@/components/shared/call-transcript";
import { LiveDot } from "@/components/shared/live-dot";
import { TripStepper } from "@/components/shared/trip-stepper";
import { Progress } from "@/components/ui/progress";
import { useLoad, useBrokerMap, useTruckMap, useDriverMap, usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { aiDispatcherNote, isTransitStage } from "@/lib/load-status";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/** Which document a stage is still waiting on — same source of truth the driver's confirm button
 *  reads from, so this card's pending rows can never disagree with what actually triggers capture. */
function pendingDocLabel(type: "bol" | "pod"): string {
  return type === "bol" ? "Bill of Lading (BOL)" : "Proof of Delivery (POD)";
}

export default function OpsLoadDetailPage() {
  const params = useParams<{ id: string }>();
  const load = useLoad(params.id);
  const brokers = useBrokerMap();
  const trucks = useTruckMap();
  const drivers = useDriverMap();
  const carrier = usePrimaryCarrier();
  const setAiPaused = useStore((s) => s.actions.setAiPaused);
  const opsOverrideRate = useStore((s) => s.actions.opsOverrideRate);
  const [overrideValue, setOverrideValue] = useState("");

  if (!load) {
    return (
      <div className="px-4 py-16 sm:px-8 text-center">
        <p className="text-sm text-ink-500">This load isn&apos;t in the current simulation window.</p>
        <Link href="/ops/loads" className="mt-3 inline-block text-sm font-medium text-ink-950 underline">
          Back to loads
        </Link>
      </div>
    );
  }

  const broker = brokers.get(load.brokerId);
  const truck = load.truckId ? trucks.get(load.truckId) : undefined;
  const driver = truck?.driverId ? drivers.get(truck.driverId) : undefined;

  function applyOverride() {
    const n = Number(overrideValue);
    if (!Number.isFinite(n) || n <= 0) return;
    opsOverrideRate(load!.id, Math.round(n));
    setOverrideValue("");
  }

  return (
    <div>
      <div className="border-b border-line bg-white/70 px-4 py-6 sm:px-8 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/ops/loads" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-950">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to loads
          </Link>
          <div className="flex items-center gap-4">
            <LiveDot label={aiDispatcherNote(load.stage)} />
            <Link href={`/carrier/loads/${load.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-950">
              View as carrier sees it <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-ink-950">
              {load.lane.origin}, {load.lane.originState} <span className="text-ink-300">→</span> {load.lane.destination}, {load.lane.destState}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {carrier.name} · {load.referenceNumber} · {load.equipmentType} · Sourced from {load.source}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LoadScoreBadge score={load.score} size="xl" />
            <div className="flex flex-col items-start gap-1.5">
              <LoadStagePill stage={load.stage} className="!text-xs !px-3 !py-1.5" />
              {load.aiPaused && <Badge tone="danger">AI paused</Badge>}
            </div>
          </div>
        </div>
        <div className="mt-4">
          {isTransitStage(load.stage) ? <TripStepper stage={load.stage} /> : <Progress value={load.progressPct} />}
        </div>
        <div className="mt-4 flex items-center gap-6">
          <span className="text-sm text-ink-500">Total offer <span className="font-display text-lg font-semibold tabular text-ink-950">{formatCurrency(load.bookedRate ?? load.targetRate)}</span></span>
          <span className="text-sm text-ink-500">Est. net <span className="font-display text-lg font-semibold tabular text-ink-950">{load.netProfit !== null ? formatCurrency(load.netProfit) : "—"}</span></span>
        </div>
      </div>

      <div className="grid gap-6 px-4 py-6 sm:px-8 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card className="border-[var(--accent-warn)]/40">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-[var(--accent-warn)]" /> Ops controls</CardTitle>
                <CardDescription>Internal only. Every action here is logged and visible to the carrier.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="!pt-3 flex flex-col gap-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-3.5">
                <div>
                  <p className="text-sm font-medium text-ink-900">AI negotiation</p>
                  <p className="text-xs text-ink-500">
                    {load.aiPaused
                      ? isTransitStage(load.stage)
                        ? "Paused, but has no effect now; the driver, not the AI, owns pickup/delivery from here."
                        : "Paused. The AI will not advance this load."
                      : "Running normally"}
                  </p>
                </div>
                <Button
                  variant={load.aiPaused ? "primary" : "danger"}
                  size="sm"
                  onClick={() => setAiPaused(load.id, !load.aiPaused)}
                >
                  {load.aiPaused ? (
                    <><Play className="h-3.5 w-3.5" /> Resume AI</>
                  ) : (
                    <><Pause className="h-3.5 w-3.5" /> Pause AI</>
                  )}
                </Button>
              </div>

              <div className="rounded-2xl border border-line p-3.5">
                <p className="text-sm font-medium text-ink-900">Override rate</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Sets the {load.bookedRate !== null ? "booked" : "target"} rate directly, bypassing AI negotiation entirely.
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">$</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={overrideValue}
                      onChange={(e) => setOverrideValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applyOverride()}
                      placeholder={String(load.bookedRate ?? load.targetRate)}
                      className="w-32 rounded-full border border-line bg-white py-1.5 pl-6 pr-3 text-sm outline-none focus:border-ink-400"
                    />
                  </div>
                  <Button size="sm" variant="outline" onClick={applyOverride} disabled={!overrideValue.trim()}>
                    Apply override
                  </Button>
                </div>
              </div>

              {load.opsOverridden && (
                <p className="flex items-center gap-1.5 text-xs text-[var(--accent-warn)]">
                  <ShieldAlert className="h-3.5 w-3.5" /> Ops has manually intervened on this load
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Negotiation</CardTitle>
                {broker && <p className="text-xs text-ink-500">{broker.company} · {broker.contact}</p>}
              </div>
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
                  label="Net profit"
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
