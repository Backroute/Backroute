"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { usePrimaryDriver, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import type { DvirItem } from "@/lib/types";

const CHECKLIST = [
  "Brakes",
  "Tires & wheels",
  "Lights & reflectors",
  "Steering",
  "Horn",
  "Windshield wipers",
  "Mirrors",
  "Coupling devices",
  "Fuel & exhaust system",
  "Emergency equipment",
];

export default function DvirInspectionPage() {
  const router = useRouter();
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const submitDvir = useStore((s) => s.actions.submitDvir);
  const inspections = useStore((s) => s.dvirInspections).filter((d) => d.driverId === driver.id);

  const [kind, setKind] = useState<"pre_trip" | "post_trip">("pre_trip");
  const [items, setItems] = useState<Record<string, "ok" | "defect">>(() => Object.fromEntries(CHECKLIST.map((c) => [c, "ok"])));
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState<"pass" | "defect" | null>(null);

  function toggle(label: string) {
    setItems((prev) => ({ ...prev, [label]: prev[label] === "ok" ? "defect" : "ok" }));
  }

  function handleSubmit() {
    if (!truck) return;
    const dvirItems: DvirItem[] = CHECKLIST.map((label) => ({ label, status: items[label] }));
    const overall = dvirItems.some((i) => i.status === "defect") ? "defect" : "pass";
    submitDvir(driver.id, truck.id, kind, dvirItems, notes.trim() || undefined);
    setSubmitted(overall);
    setTimeout(() => router.push("/driver"), 1800);
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-24 text-center">
        <div className={cn("flex h-14 w-14 items-center justify-center rounded-full text-white", submitted === "pass" ? "bg-ink-950" : "bg-[var(--accent-warn)]")}>
          {submitted === "pass" ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
        </div>
        <p className="font-display text-xl text-ink-950">{submitted === "pass" ? "Inspection logged — no defects" : "Defect flagged"}</p>
        <p className="text-sm text-ink-500">
          {submitted === "pass"
            ? "You're clear to roll."
            : "Sent to your carrier for review — a human will follow up before this truck goes back out."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-5">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      <div>
        <h1 className="font-display text-2xl text-ink-950">Vehicle inspection</h1>
        <p className="mt-1 text-sm text-ink-500">{truck ? `${truck.unitNumber} · ${truck.equipmentType}` : "No truck assigned"}</p>
      </div>

      <div className="flex rounded-full bg-ink-100 p-1">
        {(["pre_trip", "post_trip"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "flex-1 rounded-full py-2 text-xs font-medium transition-colors",
              kind === k ? "bg-ink-950 text-white" : "text-ink-500",
            )}
          >
            {k === "pre_trip" ? "Pre-trip" : "Post-trip"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {CHECKLIST.map((label) => (
          <button
            key={label}
            onClick={() => toggle(label)}
            className={cn(
              "flex items-center justify-between rounded-2xl border p-3.5 text-left transition-colors",
              items[label] === "defect" ? "border-[var(--accent-danger)]/40 bg-red-50" : "border-line",
            )}
          >
            <span className="text-sm font-medium text-ink-900">{label}</span>
            <Badge tone={items[label] === "defect" ? "danger" : "success"}>
              {items[label] === "defect" ? "Defect" : "OK"}
            </Badge>
          </button>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes on any defects (optional)"
        rows={3}
        className="rounded-2xl border border-line bg-ink-50/60 p-3.5 text-sm outline-none focus:border-ink-400"
      />

      <Button size="lg" disabled={!truck} onClick={handleSubmit}>
        Submit {kind === "pre_trip" ? "pre-trip" : "post-trip"} inspection
      </Button>

      {inspections.length > 0 && (
        <div className="flex flex-col gap-2 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Recent inspections</p>
          {inspections.slice(0, 5).map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-3.5 w-3.5 text-ink-400" />
                <div>
                  <p className="text-xs font-medium text-ink-900">{d.kind === "pre_trip" ? "Pre-trip" : "Post-trip"}</p>
                  <p className="text-[11px] text-ink-400">{formatDate(d.createdAt)}</p>
                </div>
              </div>
              <Badge tone={d.overallStatus === "pass" ? "success" : "danger"}>{d.overallStatus === "pass" ? "Pass" : "Defect"}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
