"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, Clock, DollarSign, FileText, LifeBuoy, MapPin, MessageCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TripStepper } from "@/components/shared/trip-stepper";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { StageConfirmButton } from "@/components/shared/stage-confirm-button";
import { useLoad, useCarrierTrucks, usePrimaryDriver } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { LOAD_STATUS_HEADLINE, aiDispatcherNote, isTransitStage } from "@/lib/load-status";
import { LOAD_STAGE_LABEL } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/** Which document a stage is still waiting on — matched against STAGE_CONFIRM so this page's
 *  pending rows always agree with what the confirm button above them is about to do. */
function pendingDocLabel(type: "bol" | "pod"): string {
  return type === "bol" ? "Bill of Lading (BOL)" : "Proof of Delivery (POD)";
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-ink-400" />
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{title}</p>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-500">{label}</span>
      <span className={`tabular text-sm ${strong ? "font-semibold" : "font-medium"} text-ink-950`}>{value}</span>
    </div>
  );
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
  const pendingType = step?.doc && !load.documents.some((d) => d.type === step.doc) ? step.doc : null;

  return (
    <div className="flex flex-col gap-5 px-5">
      <div className="flex items-center gap-3">
        <Link href="/driver" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-700 hover:bg-ink-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-sm font-semibold text-ink-950">Load detail</h1>
      </div>

      <div className="rounded-3xl bg-ink-950 p-5 text-white">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white/70">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-live)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-live)]" />
            </span>
            {aiDispatcherNote(load.stage)}
          </div>
          <LoadScoreBadge score={load.score} size="sm" invert />
        </div>
        <p className="mt-3 text-lg font-semibold">{LOAD_STATUS_HEADLINE[load.stage] ?? LOAD_STAGE_LABEL[load.stage]}</p>
        <p className="mt-0.5 text-sm text-white/70">
          {load.lane.origin}, {load.lane.originState}
          <span className="mx-1 text-white/40">→</span>
          {load.lane.destination}, {load.lane.destState}
        </p>
        <p className="mt-0.5 text-[11px] text-white/40">{load.referenceNumber} · {load.equipmentType} · {load.lane.miles} mi</p>

        <div className="mt-5">
          {isTransitStage(load.stage) ? (
            <TripStepper stage={load.stage} invert />
          ) : (
            <Progress value={load.progressPct} barClassName="!bg-white" className="!bg-white/15" />
          )}
        </div>

        {isCurrent && (
          <div className="mt-5 flex flex-col gap-2">
            {load.stage === "negotiating" && (
              <CounterOfferButton load={load} onSubmit={(amount) => requestBetterRate(load.id, "driver", amount)} variant="dark" />
            )}
            <StageConfirmButton loadId={load.id} stage={load.stage} onConfirm={driverConfirmStage} />
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

      <SectionCard title="Trip details" icon={MapPin}>
        <div className="flex flex-col">
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink-950 text-ink-950">
              <MapPin className="h-3.5 w-3.5" />
            </span>
            <div className="pb-3">
              <p className="text-sm font-medium text-ink-950">{load.lane.origin}, {load.lane.originState}</p>
              <p className="text-xs text-ink-500">Pickup · {load.pickupWindow}</p>
            </div>
          </div>
          <div className="ml-3.5 -my-1 h-3 w-px bg-ink-200" />
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-950 text-white">
              <MapPin className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink-950">{load.lane.destination}, {load.lane.destState}</p>
              <p className="text-xs text-ink-500">Delivery · {load.deliveryWindow}</p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Rate & earnings" icon={DollarSign}>
        <div className="flex flex-col gap-2.5">
          <Row label="Total offer" value={formatCurrency(load.bookedRate ?? load.targetRate)} strong />
          <Row label={load.bookedRate ? "Net profit (after our 2%)" : "Est. net profit"} value={formatCurrency(load.netProfit ?? 0)} />
          <Row label="Rate / mile" value={load.rpm ? `$${load.rpm.toFixed(2)}` : "—"} />
        </div>
      </SectionCard>

      <SectionCard title="Documents" icon={FileText}>
        <div id="documents" className="flex flex-col gap-2">
          {load.documents.length === 0 && !pendingType && (
            <p className="py-4 text-center text-sm text-ink-400">No documents yet for this load.</p>
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
      </SectionCard>
    </div>
  );
}
