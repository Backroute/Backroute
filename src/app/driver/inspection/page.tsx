"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { usePrimaryDriver, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import type { DvirItem } from "@/lib/types";
import { LargeTitle } from "@/components/ui/large-title";
import { DVIR_CHECKLIST } from "@/lib/dvir";
import { autoCrop } from "@/lib/doc-scan";
import { uploadFile } from "@/lib/cloud/files";

const CHECKLIST = DVIR_CHECKLIST;

export default function DvirInspectionPage() {
  return (
    <Suspense>
      <DvirInspection />
    </Suspense>
  );
}

function DvirInspection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const submitDvir = useStore((s) => s.actions.submitDvir);
  const inspections = useStore((s) => s.dvirInspections).filter((d) => d.driverId === driver.id);

  const [kind, setKind] = useState<"pre_trip" | "post_trip">(searchParams.get("kind") === "post_trip" ? "post_trip" : "pre_trip");
  const [items, setItems] = useState<Record<string, "ok" | "defect">>(() => Object.fromEntries(CHECKLIST.map((c) => [c, "ok"])));
  const [notes, setNotes] = useState("");
  // Each defect's own words and photo, so the shop and the owner see exactly what's wrong.
  const [details, setDetails] = useState<Record<string, { note: string; preview?: string; fileId?: string; uploading?: boolean }>>({});
  const real = useStore((s) => s.session.mode !== "demo");

  async function photo(label: string, file: File) {
    const page = (await autoCrop(file)).file;
    const preview = URL.createObjectURL(page);
    setDetails((d) => ({ ...d, [label]: { note: d[label]?.note ?? "", preview, uploading: real } }));
    if (!real) return;
    const r = await uploadFile("dvir_photo", page);
    setDetails((d) => ({ ...d, [label]: { ...d[label], uploading: false, ...(r.ok ? { fileId: r.id } : {}) } }));
  }
  const [submitted, setSubmitted] = useState<"pass" | "defect" | null>(null);

  function toggle(label: string) {
    setItems((prev) => ({ ...prev, [label]: prev[label] === "ok" ? "defect" : "ok" }));
  }

  function handleSubmit() {
    if (!truck) return;
    const dvirItems: DvirItem[] = CHECKLIST.map((label) => {
      const d = items[label] === "defect" ? details[label] : undefined;
      return { label, status: items[label], ...(d?.note.trim() ? { note: d.note.trim() } : {}), ...(d?.fileId ? { photoFileId: d.fileId } : {}), ...(d?.preview && !d.fileId ? { photoPreview: d.preview } : {}) };
    });
    const overall = dvirItems.some((i) => i.status === "defect") ? "defect" : "pass";
    submitDvir(driver.id, truck.id, kind, dvirItems, notes.trim() || undefined);
    setSubmitted(overall);
    setTimeout(() => router.push("/driver"), 1800);
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-24 text-center">
        <div className={cn("flex h-14 w-14 items-center justify-center rounded-full text-white", submitted === "pass" ? "bg-ink-950" : "bg-[var(--dot-warn)]")}>
          {submitted === "pass" ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
        </div>
        <p className="font-display text-xl text-ink-950">{submitted === "pass" ? "Inspection logged, no defects" : "Defect flagged"}</p>
        <p className="text-sm text-ink-500">
          {submitted === "pass"
            ? "You're clear to roll."
            : "Sent to your carrier for review. A human will follow up before this truck goes back out."}
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
        <LargeTitle className="font-display text-2xl text-ink-950">Vehicle inspection</LargeTitle>
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
          <div key={label} className={cn("rounded-2xl border border-line", items[label] === "defect" && "bg-danger-soft")}>
            <button type="button" onClick={() => toggle(label)} aria-pressed={items[label] === "defect"} className="flex w-full items-center justify-between p-3.5 text-left">
              <span className="text-sm font-medium text-ink-900">{label}</span>
              <Badge tone={items[label] === "defect" ? "danger" : "success"}>{items[label] === "defect" ? "Defect" : "OK"}</Badge>
            </button>
            {items[label] === "defect" && (
              <div className="flex items-center gap-2 px-3.5 pb-3.5">
                <input
                  value={details[label]?.note ?? ""}
                  onChange={(e) => setDetails((d) => ({ ...d, [label]: { ...d[label], note: e.target.value } }))}
                  placeholder="What's wrong?"
                  aria-label={`What's wrong with the ${label.toLowerCase()}`}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400"
                />
                <label className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded-xl border border-line bg-white px-3 text-xs font-semibold text-ink-900">
                  {details[label]?.preview ? (
                    <span aria-hidden className="h-7 w-7 rounded-md bg-cover bg-center" style={{ backgroundImage: `url(${details[label]!.preview})` }} />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  {details[label]?.uploading ? "Saving…" : details[label]?.preview ? "Retake" : "Photo"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    aria-label={`Photo of the ${label.toLowerCase()} problem`}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void photo(label, f);
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything else (optional)"
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
                  <p className="text-xs text-ink-400">{formatDate(d.createdAt)}</p>
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
