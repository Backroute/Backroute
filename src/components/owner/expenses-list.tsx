"use client";

import { CheckCircle2, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lane } from "@/components/ui/lane";
import { openFile } from "@/lib/cloud/files";
import { formatCurrency } from "@/lib/utils";
import type { Driver, Expense, Load } from "@/lib/types";

const EXPENSE_CATEGORY_LABEL: Record<Expense["category"], string> = {
  lumper: "Lumper fee",
  detention: "Detention",
  parking: "Parking",
  scale: "Scale ticket",
  other: "Other",
};

/** What drivers paid out of pocket on loads (lumpers, scale tickets, parking), with the receipt, to approve or deny. */
export function ExpensesList({
  expenses,
  drivers,
  loads,
  onRespond,
}: {
  expenses: Expense[];
  drivers: Map<string, Driver>;
  loads: Load[];
  onRespond: (id: string, approve: boolean) => void;
}) {
  if (expenses.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">No expenses submitted yet. What drivers pay out of pocket, like lumper fees or scale tickets, shows up here.</p>;
  }
  const loadMap = new Map(loads.map((l) => [l.id, l]));
  const sorted = [...expenses].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((e) => {
        const driver = drivers.get(e.driverId);
        const load = e.loadId ? loadMap.get(e.loadId) : undefined;
        return (
          <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
            <div className="flex items-center gap-3">
              <Avatar name={driver?.name ?? "Driver"} size="sm" />
              <div>
                <p className="text-sm font-medium text-ink-950">{EXPENSE_CATEGORY_LABEL[e.category]} · {driver?.name ?? "Driver"}</p>
                <p className="text-xs text-ink-400">
                  {load && (
                    <>
                      <Lane from={load.lane.origin} to={load.lane.destination} />
                      {" · "}
                    </>
                  )}
                  {e.note || "No note"}
                  {(e.receiptFileId || e.receiptPreview) && (
                    <>
                      {" · "}
                      {e.receiptFileId ? (
                        <button type="button" onClick={() => void openFile(e.receiptFileId!)} className="font-medium text-ink-700 underline-offset-2 hover:underline">
                          See the receipt
                        </button>
                      ) : (
                        <a href={e.receiptPreview} target="_blank" rel="noreferrer" className="font-medium text-ink-700 underline-offset-2 hover:underline">
                          See the receipt
                        </a>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tabular text-ink-950">{formatCurrency(e.amount)}</span>
              {e.status === "pending" ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="primary" onClick={() => onRespond(e.id, true)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onRespond(e.id, false)}>
                    <X className="h-3.5 w-3.5" /> Deny
                  </Button>
                </div>
              ) : (
                <Badge tone={e.status === "approved" ? "success" : "danger"}>{e.status}</Badge>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
