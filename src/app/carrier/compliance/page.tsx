"use client";

import { AlertTriangle, CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { AddonGate } from "@/components/shared/addon-gate";
import { useCarrierLoads, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { PRIMARY_CARRIER_ID } from "@/lib/mock-data";
import { estimateMilesByState, estimateFuelTaxOwed } from "@/lib/ifta";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

const INSURANCE_POLICY = {
  carrier: "Reliance Commercial Insurance",
  policyNumber: "RCI-TX-84471",
  coverageAmount: 1_000_000,
  renewalDate: "2026-11-01T00:00:00Z",
  premium: 1840,
};

export default function CompliancePage() {
  const loads = useCarrierLoads();
  const trucks = useCarrierTrucks();
  const incidents = useStore((s) => s.incidents).filter((i) => i.carrierId === PRIMARY_CARRIER_ID);
  const activeAccidents = incidents.filter((i) => i.type === "accident" && i.status === "active");

  const quarterLoads = loads.filter((l) => l.stage !== "sourced" && l.stage !== "scoring" && l.stage !== "offered" && l.stage !== "declined");
  const stateMiles = estimateMilesByState(quarterLoads);
  const totalMiles = stateMiles.reduce((s, x) => s + x.miles, 0);
  const avgMpg = trucks.length ? trucks.reduce((s, t) => s + t.mpg, 0) / trucks.length : 6.5;
  const fuelTaxOwed = estimateFuelTaxOwed(totalMiles, avgMpg);

  return (
    <div>
      <PageHeader title="Compliance" description="IFTA filing and insurance, kept current automatically" />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><FileCheck2 className="h-4 w-4" /> IFTA — this quarter</CardTitle>
              <CardDescription>Estimated from lane miles per truck. Review before filing — not a substitute for your ELD&apos;s official mileage report.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            <AddonGate addonId="compliance-ai">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatTile label="Total miles" value={formatNumber(totalMiles)} />
                <StatTile label="Estimated tax owed" value={formatCurrency(fuelTaxOwed)} />
                <StatTile label="Jurisdictions" value={stateMiles.length} />
              </div>
              <div className="mt-5 flex flex-col divide-y divide-line rounded-2xl border border-line">
                {stateMiles.map((s) => (
                  <div key={s.state} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-ink-700">{s.state}</span>
                    <span className="tabular text-ink-500">{formatNumber(s.miles)} mi</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-[var(--accent-live)]"><CheckCircle2 className="h-4 w-4" /> Draft filing ready — no missing receipts flagged</span>
                <Button size="sm" variant="outline">Review & file</Button>
              </div>
            </AddonGate>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Insurance</CardTitle>
              <CardDescription>Coverage status and renewal tracking.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            <AddonGate addonId="insurance-ai">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line p-4">
                <div>
                  <p className="text-sm font-medium text-ink-900">{INSURANCE_POLICY.carrier}</p>
                  <p className="text-xs text-ink-500">Policy {INSURANCE_POLICY.policyNumber} · {formatCurrency(INSURANCE_POLICY.coverageAmount)} coverage · {formatCurrency(INSURANCE_POLICY.premium)}/mo</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Active</Badge>
                  <span className="text-xs text-ink-500">Renews {formatDate(INSURANCE_POLICY.renewalDate)}</span>
                </div>
              </div>

              {activeAccidents.length > 0 ? (
                <div className="mt-4 flex flex-col gap-2.5">
                  {activeAccidents.map((incident) => (
                    <div key={incident.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-3">
                      <span className="flex items-center gap-2 text-sm text-[var(--accent-warn)]">
                        <AlertTriangle className="h-4 w-4" /> Accident reported — claim assist ready
                      </span>
                      <Button size="sm" variant="outline">Start claim</Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-xs text-ink-400">No open incidents requiring a claim.</p>
              )}
            </AddonGate>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
