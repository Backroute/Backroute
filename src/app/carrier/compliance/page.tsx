"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { AddonGate } from "@/components/shared/addon-gate";
import { PaperworkCard } from "@/components/owner/paperwork-card";
import { useCarrierTrucks, useDriverMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { PRIMARY_CARRIER_ID } from "@/lib/mock-data";
import { INSURANCE_REFERRAL_FEE } from "@/lib/commissions";
import { IftaCard } from "@/components/owner/ifta-card";
import Link from "next/link";
import { downloadCsv } from "@/lib/csv-export";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";

const INSURANCE_POLICY = {
  carrier: "Reliance Commercial Insurance",
  policyNumber: "RCI-TX-84471",
  coverageAmount: 1_000_000,
  renewalDate: "2026-11-01T00:00:00Z",
  premium: 1840,
};

export default function CompliancePage() {
  const trucks = useCarrierTrucks();
  const drivers = useDriverMap();
  const truckMap = new Map(trucks.map((t) => [t.id, t]));
  const incidents = useStore((s) => s.incidents).filter((i) => i.carrierId === PRIMARY_CARRIER_ID);
  const activeAccidents = incidents.filter((i) => i.type === "accident" && i.status === "active");
  const startClaim = useStore((s) => s.actions.startClaim);
  const dvirInspections = useStore((s) => s.dvirInspections)
    .filter((d) => d.carrierId === PRIMARY_CARRIER_ID)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const defectCount = dvirInspections.filter((d) => d.overallStatus === "defect").length;
  // The sample policy is the practice fleet's; a real account shows what the owner put on file.
  const demo = useStore((s) => s.session.mode === "demo");
  const insuranceExpires = useStore((s) => s.settings.insuranceExpires);
  const cargoInsurer = useStore((s) => s.settings.cargoInsurerEmail);

  return (
    <div>
      <PageHeader title="Compliance" description="IFTA filing and insurance, kept current automatically" />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <PaperworkCard />

        <IftaCard />

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Insurance</CardTitle>
              <CardDescription>Coverage status and renewal tracking.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            <AddonGate addonId="insurance-ai">
              {!demo ? (
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line p-4">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{insuranceExpires ? `Certificate runs out ${formatDate(insuranceExpires)}` : "No insurance certificate on file"}</p>
                    <p className="text-xs text-ink-500">
                      {cargoInsurer ? `Claims go to ${cargoInsurer}.` : "Add your insurer's claims email so a claim file can go straight to them."} Setup packets send the certificate to brokers.
                    </p>
                  </div>
                  <Link href="/carrier/settings?tab=basics" className="text-sm font-medium text-ink-950 underline">
                    {insuranceExpires ? "Update" : "Add it"}
                  </Link>
                </div>
              ) : (
              <>
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

              <p className="mt-3 text-xs text-ink-400">
                Sample policy. Free to you. Backroute earned {formatCurrency(INSURANCE_REFERRAL_FEE)} in referral commission from {INSURANCE_POLICY.carrier} when this policy was bound.
              </p>
              </>
              )}

              {activeAccidents.length > 0 ? (
                <div className="mt-4 flex flex-col gap-2.5">
                  {activeAccidents.map((incident) =>
                    incident.claimStartedAt ? (
                      <div key={incident.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-live-soft px-4 py-3">
                        <span className="flex items-center gap-2 text-sm text-[var(--accent-live)]">
                          <CheckCircle2 className="h-4 w-4" /> Claim started, {demo ? INSURANCE_POLICY.carrier : "your insurer"} notified
                        </span>
                        <Badge tone="success">In progress</Badge>
                      </div>
                    ) : (
                      <div key={incident.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn-soft px-4 py-3">
                        <span className="flex items-center gap-2 text-sm text-[var(--accent-warn)]">
                          <AlertTriangle className="h-4 w-4" /> Accident reported, claim assist ready
                        </span>
                        <Button size="sm" variant="outline" onClick={() => startClaim(incident.id)}>Start claim</Button>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <p className="mt-4 text-xs text-ink-400">No open incidents requiring a claim.</p>
              )}
            </AddonGate>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Vehicle inspections</CardTitle>
              <CardDescription>Pre-trip and post-trip inspections logged by drivers.</CardDescription>
            </div>
            {dvirInspections.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    `dvir-inspections-${new Date().toISOString().slice(0, 10)}.csv`,
                    ["Truck", "Driver", "Type", "Status", "Notes", "Date"],
                    dvirInspections.map((d) => [
                      truckMap.get(d.truckId)?.unitNumber ?? d.truckId,
                      drivers.get(d.driverId)?.name ?? "",
                      d.kind === "pre_trip" ? "Pre-trip" : "Post-trip",
                      d.overallStatus,
                      d.notes ?? "",
                      d.createdAt,
                    ]),
                  )
                }
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            )}
          </CardHeader>
          <CardContent className="!pt-3">
            {dvirInspections.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-400">No inspections logged yet. Drivers submit these before and after every trip.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <StatTile label="Logged" value={dvirInspections.length} />
                  <StatTile label="Defects flagged" value={defectCount} />
                  <StatTile label="Trucks covered" value={new Set(dvirInspections.map((d) => d.truckId)).size} />
                </div>
                <div className="mt-5 flex flex-col divide-y divide-line rounded-2xl border border-line">
                  {dvirInspections.slice(0, 8).map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-ink-900">
                          {truckMap.get(d.truckId)?.unitNumber ?? "Truck"} · {d.kind === "pre_trip" ? "Pre-trip" : "Post-trip"}
                        </p>
                        <p className="text-xs text-ink-400">
                          {drivers.get(d.driverId)?.name ?? "Driver"} · {formatDateTime(d.createdAt)}
                          {d.notes ? ` · ${d.notes}` : ""}
                        </p>
                      </div>
                      <Badge tone={d.overallStatus === "pass" ? "success" : "danger"}>
                        {d.overallStatus === "pass" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {d.overallStatus === "pass" ? "Pass" : "Defect noted"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
