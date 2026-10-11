"use client";

import { FileDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStore } from "@/lib/store";
import { usePrimaryCarrier } from "@/lib/selectors";
import { downloadPdf, tripReport, tripReportLines } from "@/lib/statements";
import type { Load } from "@/lib/types";

/** A delivered load start to finish: times at each dock, papers, weights, and what it made after fuel and tolls. */
export function TripReportCard({ load, truck, driver, broker }: { load: Load; truck?: string; driver?: string; broker?: string }) {
  const fuel = useStore((s) => s.fuelTx);
  const tolls = useStore((s) => s.tollTx);
  const expenses = useStore((s) => s.expenses);
  const carrier = usePrimaryCarrier();
  const lumpers = expenses.filter((e) => e.loadId === load.id && e.category === "lumper" && e.status !== "denied").reduce((s, e) => s + e.amount, 0);
  const report = tripReport(load, { truck, driver, broker, fuel, tolls, lumpers });
  const sections = [...new Set(report.rows.map((r) => r.section))];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Trip report</CardTitle>
          <button
            type="button"
            onClick={() => void downloadPdf(`trip-${load.referenceNumber}.pdf`, tripReportLines(load, report, carrier.name))}
            className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            <FileDown className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-4">
        {sections.map((sec) => (
          <div key={sec}>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{sec}</p>
            <dl className="mt-1.5 flex flex-col gap-1 text-sm">
              {report.rows
                .filter((r) => r.section === sec)
                .map((r) => (
                  <div key={`${sec}-${r.label}`} className="flex justify-between gap-3">
                    <dt className="text-ink-500">{r.label}</dt>
                    <dd className="text-right font-medium tabular text-ink-950">{r.value}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
