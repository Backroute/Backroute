"use client";

import Link from "next/link";
import { ArrowUpRight, Camera, CheckCircle2, Clock, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads } from "@/lib/selectors";
import { formatDateTime } from "@/lib/utils";
import type { Load } from "@/lib/types";

/** Which document a stage is still waiting on, and where the driver actually captures it — this page never
 *  offers its own capture button, so there's only one place documents get filed instead of two that could
 *  disagree with each other. */
function pendingDocNote(load: Load, type: "bol" | "pod"): string | null {
  if (load.documents.some((d) => d.type === type)) return null;
  if (type === "bol") {
    if (load.stage === "dispatched") return "Captured once you confirm you're loaded at pickup.";
    if (load.stage === "at_pickup") return "Confirm you're loaded to capture this now.";
    return null;
  }
  if (load.stage === "dispatched" || load.stage === "at_pickup" || load.stage === "in_transit") {
    return "Captured once you confirm delivery.";
  }
  if (load.stage === "at_delivery") return "Confirm delivery to capture this now.";
  return null;
}

function PendingDocRow({ label, note, loadId }: { label: string; note: string; loadId: string }) {
  const actionable = note.startsWith("Confirm");
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-ink-300 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-50 text-ink-400">
          <Camera className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-medium text-ink-700">{label}</p>
          <p className="text-[11px] text-ink-400">{note}</p>
        </div>
      </div>
      {actionable && (
        <Link href={`/driver/loads/${loadId}`} className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-950 hover:underline">
          Open load <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

export default function DriverDocumentsPage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();

  const truck = trucks.find((t) => t.id === driver.truckId);
  // currentLoadId clears the moment a load is delivered, so fall back to the truck's most
  // recently delivered load — otherwise the paperwork the driver just captured vanishes instantly.
  const lastDelivered = [...loads]
    .filter((l) => l.truckId === truck?.id && l.stage === "delivered")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const currentLoad = loads.find((l) => l.id === truck?.currentLoadId) ?? lastDelivered;

  const bolNote = currentLoad ? pendingDocNote(currentLoad, "bol") : null;
  const podNote = currentLoad ? pendingDocNote(currentLoad, "pod") : null;

  return (
    <div className="flex flex-col gap-5 px-5">
      <div>
        <h1 className="font-display text-2xl text-ink-950">Documents</h1>
        <p className="text-xs text-ink-500">Filed automatically as the AI confirms each stage with you on Home.</p>
      </div>

      {currentLoad ? (
        <div>
          <Link
            href={`/driver/loads/${currentLoad.id}`}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-ink-400 hover:text-ink-950"
          >
            {currentLoad.referenceNumber} <ArrowUpRight className="h-3 w-3" />
          </Link>
          <div className="flex flex-col gap-2">
            {currentLoad.documents.length === 0 && !bolNote && !podNote ? (
              <p className="py-6 text-center text-sm text-ink-400">No documents yet for this load.</p>
            ) : (
              <>
                {currentLoad.documents.map((doc) => (
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
                    <Badge tone={doc.status === "verified" ? "success" : "warning"}>
                      {doc.status === "verified" ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {doc.status}
                    </Badge>
                  </div>
                ))}
                {bolNote && <PendingDocRow label="Bill of Lading (BOL)" note={bolNote} loadId={currentLoad.id} />}
                {podNote && <PendingDocRow label="Proof of Delivery (POD)" note={podNote} loadId={currentLoad.id} />}
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-ink-400">No active load to attach documents to.</p>
      )}
    </div>
  );
}
