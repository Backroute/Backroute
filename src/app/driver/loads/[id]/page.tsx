"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, Clock, FileText, LifeBuoy, MessageCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TripProgress } from "@/components/shared/trip-progress";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { useLoad, useCarrierTrucks, usePrimaryDriver } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { LOAD_STATUS_HEADLINE, isTransitStage, nextStop } from "@/lib/load-status";
import { LOAD_STAGE_LABEL } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/** Which document a stage is still waiting on — matched against STAGE_CONFIRM so this page's
 *  pending rows always agree with what the confirm button above them is about to do. */
function pendingDocLabel(type: "bol" | "pod"): string {
  return type === "bol" ? "Bill of Lading (BOL)" : "Proof of Delivery (POD)";
}

export default function DriverLoadDetailPage() {
  const params = useParams<{ id: string }>();
  const load = useLoad(params.id);
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const requestBetterRate = useStore((s) => s.actions.requestBetterRate);
  const driverConfirmStage = useStore((s) => s.actions.driverConfirmStage);
  const recaptureDocument = useStore((s) => s.actions.recaptureDocument);

  if (!load) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="text-sm text-ink-500">This load isn&apos;t in the current simulation window.</p>
        <Link href="/driver" className="mt-3 inline-block text-sm font-medium text-ink-950 underline">
          Back to Home
        </Link>
      </div>
    );
  }

  const truck = trucks.find((t) => t.id === driver.truckId);
  const isCurrent = truck?.currentLoadId === load.id;
  const step = STAGE_CONFIRM[load.stage];
  const Icon = step?.icon;
  const pendingType = step?.doc && !load.documents.some((d) => d.type === step.doc) ? step.doc : null;

  return (
    <div className="flex flex-col gap-5 px-5">
      <Link href="/driver" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-950">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
      </Link>

      <div className="rounded-3xl bg-ink-950 p-5 text-white">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">{isCurrent ? "Current load" : "Load detail"}</span>
          <LoadScoreBadge score={load.score} size="sm" invert />
        </div>
        <p className="mt-1.5 text-lg font-semibold">{LOAD_STATUS_HEADLINE[load.stage] ?? LOAD_STAGE_LABEL[load.stage]}</p>
        <p className="mt-0.5 text-sm text-white/70">
          {load.lane.origin}, {load.lane.originState}
          <span className="mx-1 text-white/40">→</span>
          {load.lane.destination}, {load.lane.destState}
        </p>
        <p className="mt-0.5 text-[11px] text-white/40">{load.referenceNumber} · {load.equipmentType} · {load.lane.miles} mi</p>

        <div className="mt-4">
          {isTransitStage(load.stage) ? (
            <TripProgress stage={load.stage} invert />
          ) : (
            <Progress value={load.progressPct} barClassName="!bg-white" className="!bg-white/15" />
          )}
        </div>

        <div className="mt-3.5 flex items-center justify-between text-xs text-white/50">
          <span>{nextStop(load).label} <span className="font-medium text-white">{nextStop(load).window}</span></span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs text-white/50">
          <span>Total offer <span className="font-medium text-white">{formatCurrency(load.bookedRate ?? load.targetRate)}</span></span>
          <span>Est. net <span className="font-medium text-white">{formatCurrency(load.netProfit ?? 0)}</span></span>
        </div>

        {isCurrent && (
          <div className="mt-4 flex flex-col gap-2">
            {load.stage === "negotiating" && (
              <CounterOfferButton load={load} onSubmit={(amount) => requestBetterRate(load.id, "driver", amount)} variant="dark" />
            )}
            {step && Icon && (
              <button
                onClick={() => driverConfirmStage(load.id)}
                className="flex items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-semibold text-ink-950"
              >
                <Icon className="h-4 w-4" /> {step.label}
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Link href="/driver/messages" className="flex items-center justify-center gap-2 rounded-full border border-white/25 py-3 text-sm font-medium text-white">
                <MessageCircle className="h-4 w-4" /> Message AI
              </Link>
              <Link href="/driver/incident" className="flex items-center justify-center gap-2 rounded-full border border-white/25 py-3 text-sm font-medium text-white">
                <LifeBuoy className="h-4 w-4" /> Report issue
              </Link>
            </div>
          </div>
        )}
      </div>

      <div id="documents">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Documents</p>
        <div className="flex flex-col gap-2">
          {load.documents.length === 0 && !pendingType && (
            <p className="py-6 text-center text-sm text-ink-400">No documents yet for this load.</p>
          )}
          {load.documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                  <FileText className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-medium text-ink-900">{doc.name}</p>
                  <p className="text-[11px] text-ink-400">{formatDateTime(doc.generatedAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={doc.status === "verified" ? "success" : "warning"}>
                  {doc.status === "verified" ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {doc.status}
                </Badge>
                {(doc.type === "bol" || doc.type === "pod") && (
                  <button
                    onClick={() => recaptureDocument(load.id, doc.type as "bol" | "pod")}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-950 hover:underline"
                  >
                    <Camera className="h-3 w-3" /> Retake
                  </button>
                )}
              </div>
            </div>
          ))}
          {pendingType && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-ink-300 px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-50 text-ink-400">
                  <Camera className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-medium text-ink-700">{pendingDocLabel(pendingType)}</p>
                  <p className="text-[11px] text-ink-400">
                    {isCurrent ? "Captured when you confirm above." : "Captured once this load reaches that stage."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
