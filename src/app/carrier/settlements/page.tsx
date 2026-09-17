"use client";

import { useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { StatTile } from "@/components/ui/stat-tile";
import { AddonGate } from "@/components/shared/addon-gate";
import { useCarrierLoads, useDriverMap, useTruckMap } from "@/lib/selectors";
import { useNow } from "@/lib/hooks";
import { deriveFactoringSettlement, computeDriverPay, FACTORING_FEE_PCT } from "@/lib/settlements";
import { formatCurrency } from "@/lib/utils";
import type { Driver, Load, Truck } from "@/lib/types";

export default function SettlementsPage() {
  const loads = useCarrierLoads();
  const drivers = useDriverMap();
  const trucks = useTruckMap();
  const now = useNow();
  const [tab, setTab] = useState<"factoring" | "driver-pay">("factoring");

  const delivered = loads.filter((l) => l.stage === "delivered");

  return (
    <div>
      <PageHeader title="Settlements" description={`${delivered.length} delivered loads`} />

      <div className="px-4 py-6 sm:px-8">
        <Tabs
          tabs={[
            { key: "factoring", label: "Factoring", count: delivered.length },
            { key: "driver-pay", label: "Driver pay", count: delivered.length },
          ]}
          active={tab}
          onChange={(k) => setTab(k as "factoring" | "driver-pay")}
        />

        <div className="mt-5">
          {tab === "factoring" ? (
            <AddonGate addonId="factoring-ai">
              <FactoringList loads={delivered} now={now} />
            </AddonGate>
          ) : (
            <AddonGate addonId="driver-settlement-ai">
              <DriverPayList loads={delivered} drivers={drivers} trucks={trucks} />
            </AddonGate>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-ink-400">{text}</p>;
}

function FactoringList({ loads, now }: { loads: Load[]; now: number | null }) {
  if (loads.length === 0) return <EmptyState text="No delivered loads yet — settlements appear the moment a load delivers." />;
  if (now === null) return null;

  const settlements = loads.map((l) => deriveFactoringSettlement(l, now));
  const funded = settlements.filter((s) => s.status === "funded");
  const pending = settlements.filter((s) => s.status === "submitted");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card><CardContent><StatTile label="Funded" value={formatCurrency(funded.reduce((s, x) => s + x.netPayout, 0))} sublabel={`${funded.length} invoices`} /></CardContent></Card>
        <Card><CardContent><StatTile label="Pending funding" value={formatCurrency(pending.reduce((s, x) => s + x.netPayout, 0))} sublabel={`${pending.length} invoices`} /></CardContent></Card>
        <Card><CardContent><StatTile label={`Factoring fee (${FACTORING_FEE_PCT * 100}%)`} value={formatCurrency(settlements.reduce((s, x) => s + x.factoringFee, 0))} sublabel="vs. 30-45 day broker terms" /></CardContent></Card>
      </div>

      <div className="flex flex-col gap-2">
        {settlements.map((s) => (
          <div key={s.loadId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
            <div>
              <p className="text-sm font-medium text-ink-950">{s.lane}</p>
              <p className="text-xs text-ink-400">{s.referenceNumber} · Invoice {formatCurrency(s.invoiceAmount)} − {formatCurrency(s.factoringFee)} fee</p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold tabular text-ink-950">{formatCurrency(s.netPayout)}</p>
              <Badge tone={s.status === "funded" ? "success" : "warning"}>
                {s.status === "funded" ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {s.status === "funded" ? "Funded" : "Submitted"}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DriverPayList({ loads, drivers, trucks }: { loads: Load[]; drivers: Map<string, Driver>; trucks: Map<string, Truck> }) {
  if (loads.length === 0) return <EmptyState text="No delivered loads yet — pay statements appear the moment a load delivers." />;

  const rows = loads
    .map((l) => {
      const truck = l.truckId ? trucks.get(l.truckId) : undefined;
      const driver = truck?.driverId ? drivers.get(truck.driverId) : undefined;
      return driver ? { load: l, driver, pay: computeDriverPay(l, driver) } : null;
    })
    .filter((r): r is { load: Load; driver: Driver; pay: number } => r !== null);

  const totalPay = rows.reduce((s, r) => s + r.pay, 0);

  return (
    <div className="flex flex-col gap-5">
      <Card><CardContent><StatTile label="Total driver pay" value={formatCurrency(totalPay)} sublabel={`${rows.length} loads`} /></CardContent></Card>

      <div className="flex flex-col gap-2">
        {rows.map(({ load, driver, pay }) => (
          <div key={load.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
            <div className="flex items-center gap-3">
              <Avatar name={driver.name} size="sm" />
              <div>
                <p className="text-sm font-medium text-ink-950">{driver.name}</p>
                <p className="text-xs text-ink-400">{load.lane.origin} → {load.lane.destination} · {load.referenceNumber}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular text-ink-950">{formatCurrency(pay)}</p>
              <p className="text-[11px] text-ink-400">{driver.payType === "percentage" ? `${Math.round(driver.payRate * 100)}% of rate` : `$${driver.payRate.toFixed(2)}/mi`}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
