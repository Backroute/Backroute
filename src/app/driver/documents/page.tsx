"use client";

import { Camera, CheckCircle2, Clock, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads } from "@/lib/selectors";
import { formatDateTime } from "@/lib/utils";

export default function DriverDocumentsPage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const captureDocument = useStore((s) => s.actions.captureDocument);

  const truck = trucks.find((t) => t.id === driver.truckId);
  const currentLoad = loads.find((l) => l.id === truck?.currentLoadId);

  return (
    <div className="flex flex-col gap-5 px-5">
      <div>
        <h1 className="font-display text-2xl text-ink-950">Documents</h1>
        <p className="text-xs text-ink-500">Snap a photo — the AI verifies and files it automatically.</p>
      </div>

      {currentLoad ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => captureDocument(currentLoad.id, "bol")}
              className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink-300 py-6 text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
            >
              <Camera className="h-5 w-5" />
              <span className="text-xs font-medium">Capture BOL</span>
            </button>
            <button
              onClick={() => captureDocument(currentLoad.id, "pod")}
              className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink-300 py-6 text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
            >
              <Camera className="h-5 w-5" />
              <span className="text-xs font-medium">Capture POD</span>
            </button>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{currentLoad.referenceNumber}</p>
            <div className="flex flex-col gap-2">
              {currentLoad.documents.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-400">No documents yet for this load.</p>
              ) : (
                currentLoad.documents.map((doc) => (
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
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-ink-400">No active load to attach documents to.</p>
      )}
    </div>
  );
}
