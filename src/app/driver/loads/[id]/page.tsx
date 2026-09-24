"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, Clock, DollarSign, FileText, LifeBuoy, MapPin, MessageCircle, Receipt } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TripStepper } from "@/components/shared/trip-stepper";
import { StopsTimeline } from "@/components/shared/stops-timeline";
import { LoadScoreBadge } from "@/components/shared/load-score";
import { CounterOfferButton } from "@/components/shared/counter-offer-button";
import { useLoad, useCarrierTrucks, usePrimaryDriver } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import { LOAD_STATUS_HEADLINE, aiDispatcherNote, isTransitStage } from "@/lib/load-status";
import { LOAD_STAGE_LABEL } from "@/lib/types";
import type { Expense } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const EXPENSE_CATEGORIES: { key: Expense["category"]; label: string }[] = [
  { key: "lumper", label: "Lumper fee" },
  { key: "detention", label: "Detention" },
  { key: "parking", label: "Parking" },
  { key: "scale", label: "Scale ticket" },
  { key: "other", label: "Other" },
];

const EXPENSE_STATUS_TONE = { pending: "warning", approved: "success", denied: "danger" } as const;

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
  const recaptureDocument = useStore((s) => s.actions.recaptureDocument);
  const completeLoadStop = useStore((s) => s.actions.completeLoadStop);
  const submitExpense = useStore((s) => s.actions.submitExpense);
  const allExpenses = useStore((s) => s.expenses);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseCategory, setExpenseCategory] = useState<Expense["category"]>("lumper");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNote, setExpenseNote] = useState("");

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
  const loadId = load.id;
  const loadExpenses = allExpenses.filter((e) => e.loadId === loadId && e.driverId === driver.id);

  function handleSubmitExpense() {
    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    submitExpense(driver.id, loadId, expenseCategory, amount, expenseNote.trim());
    setExpenseAmount("");
    setExpenseNote("");
    setShowExpenseForm(false);
  }

  return (
    <div className="flex flex-col gap-5 px-5">
      <div className="flex items-center gap-3">
        <Link href="/driver" aria-label="Back to home" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-700 hover:bg-ink-50">
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
        {load.stage === "cancelled" && load.cancellationReason && (
          <p className="mt-2 text-xs text-white/60">{load.cancellationReason}</p>
        )}

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
            {step && (
              <Link href="/driver" className="flex items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-semibold text-ink-950">
                Continue on your trip card
              </Link>
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

      <SectionCard title="Trip details" icon={MapPin}>
        {load.stops && load.stops.length > 0 ? (
          <StopsTimeline load={load} onCompleteStop={isCurrent ? (stopId) => completeLoadStop(load.id, stopId) : undefined} />
        ) : (
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
        )}
      </SectionCard>

      <SectionCard title="Rate & earnings" icon={DollarSign}>
        <div className="flex flex-col gap-2.5">
          <Row label="Total offer" value={formatCurrency(load.bookedRate ?? load.targetRate)} strong />
          <Row label={load.bookedRate ? "Net profit" : "Est. net profit"} value={formatCurrency(load.netProfit ?? 0)} />
          <Row label="Per mile" value={load.rpm ? `$${load.rpm.toFixed(2)}` : "—"} />
        </div>
      </SectionCard>

      <SectionCard title="Expenses" icon={Receipt}>
        <div className="flex flex-col gap-2">
          {loadExpenses.length === 0 && !showExpenseForm && (
            <p className="py-2 text-sm text-ink-400">No expenses submitted for this load.</p>
          )}
          {loadExpenses.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3">
              <div>
                <p className="text-xs font-medium text-ink-900">{EXPENSE_CATEGORIES.find((c) => c.key === e.category)?.label}</p>
                {e.note && <p className="text-[11px] text-ink-400">{e.note}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular text-ink-950">{formatCurrency(e.amount)}</span>
                <Badge tone={EXPENSE_STATUS_TONE[e.status]}>{e.status}</Badge>
              </div>
            </div>
          ))}

          {showExpenseForm ? (
            <div className="mt-1 flex flex-col gap-2.5 rounded-xl border border-line bg-ink-50/60 p-3.5">
              <div className="flex flex-wrap gap-1.5">
                {EXPENSE_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setExpenseCategory(c.key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      expenseCategory === c.key ? "bg-ink-950 text-white" : "bg-white text-ink-600 border border-line"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-line bg-white py-2 pl-6 pr-3 text-sm outline-none focus:border-ink-400"
                />
              </div>
              <input
                value={expenseNote}
                onChange={(e) => setExpenseNote(e.target.value)}
                placeholder="Note (optional)"
                className="rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!expenseAmount.trim()} onClick={handleSubmitExpense}>Submit for reimbursement</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowExpenseForm(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="mt-1 self-start" onClick={() => setShowExpenseForm(true)}>
              Submit an expense
            </Button>
          )}
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
                  <p className="text-[11px] text-ink-400">{doc.uploadedBy === "driver" ? "Uploaded by you · " : ""}{formatDateTime(doc.generatedAt)}</p>
                  {doc.aiNote && <p className="mt-0.5 text-[11px] text-[var(--accent-live)]">AI checked: {doc.aiNote}</p>}
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
                    {isCurrent ? "Upload it from your trip card on Home." : "Captured once this load reaches that stage."}
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
