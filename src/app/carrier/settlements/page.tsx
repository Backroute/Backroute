"use client";

import { useState } from "react";
import { CheckCircle2, Clock, Download, X } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { AddonGate } from "@/components/shared/addon-gate";
import { useCarrierLoads, useDriverMap, useTruckMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { deriveFactoringSettlement, computeDriverPay, FACTORING_FEE_PCT } from "@/lib/settlements";
import { computeFactoringCommission } from "@/lib/commissions";
import { downloadCsv } from "@/lib/csv-export";
import { formatCurrency } from "@/lib/utils";
import type { Driver, Expense, Load, Truck } from "@/lib/types";

const EXPENSE_CATEGORY_LABEL: Record<Expense["category"], string> = {
  lumper: "Lumper fee",
  detention: "Detention",
  parking: "Parking",
  scale: "Scale ticket",
  other: "Other",
};

export default function SettlementsPage() {
  const loads = useCarrierLoads();
  const drivers = useDriverMap();
  const trucks = useTruckMap();
  const now = useNow();
  const expenses = useStore((s) => s.expenses);
  const respondExpense = useStore((s) => s.actions.respondExpense);
  const [tab, setTab] = useState<"factoring" | "driver-pay" | "expenses">("factoring");

  const delivered = loads.filter((l) => l.stage === "delivered");
  const pendingExpenseCount = expenses.filter((e) => e.status === "pending").length;

  return (
    <div>
      <PageHeader title="Settlements" description={`${delivered.length} delivered loads`} />

      <div className="px-4 py-6 sm:px-8">
        <Tabs
          tabs={[
            { key: "factoring", label: "Factoring", count: delivered.length },
            { key: "driver-pay", label: "Driver pay", count: delivered.length },
            { key: "expenses", label: "Expenses", count: pendingExpenseCount || undefined },
          ]}
          active={tab}
          onChange={(k) => setTab(k as "factoring" | "driver-pay" | "expenses")}
        />

        <div className="mt-5">
          {tab === "factoring" && (
            <AddonGate addonId="factoring-ai">
              <FactoringList loads={delivered} now={now} />
            </AddonGate>
          )}
          {tab === "driver-pay" && <DriverPayList loads={delivered} drivers={drivers} trucks={trucks} />}
          {tab === "expenses" && <ExpensesList expenses={expenses} drivers={drivers} loads={loads} onRespond={respondExpense} />}
        </div>
      </div>
    </div>
  );
}

function ExpensesList({
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
    return <EmptyState text="No expenses submitted yet. Driver-fronted costs like lumper fees or detention show up here." />;
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
                  {load ? `${load.lane.origin} → ${load.lane.destination} · ` : ""}
                  {e.note || "No note"}
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

function EmptyState({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-ink-400">{text}</p>;
}

function FactoringList({ loads, now }: { loads: Load[]; now: number | null }) {
  if (loads.length === 0) return <EmptyState text="No delivered loads yet. Settlements appear the moment a load delivers." />;
  if (now === null) return null;

  const settlements = loads.map((l) => deriveFactoringSettlement(l, now));
  const funded = settlements.filter((s) => s.status === "funded");
  const pending = settlements.filter((s) => s.status === "submitted");
  const backrouteCommission = settlements.reduce((s, x) => s + computeFactoringCommission(x.invoiceAmount), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            downloadCsv(
              `settlements-factoring-${new Date().toISOString().slice(0, 10)}.csv`,
              ["Lane", "Reference", "Invoice Amount", "Factoring Fee", "Net Payout", "Status"],
              settlements.map((s) => [s.lane, s.referenceNumber, s.invoiceAmount, s.factoringFee, s.netPayout, s.status]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card><CardContent><StatTile label="Funded" value={formatCurrency(funded.reduce((s, x) => s + x.netPayout, 0))} sublabel={`${funded.length} invoices`} /></CardContent></Card>
        <Card><CardContent><StatTile label="Pending funding" value={formatCurrency(pending.reduce((s, x) => s + x.netPayout, 0))} sublabel={`${pending.length} invoices`} /></CardContent></Card>
        <Card><CardContent><StatTile label={`Factoring fee (${FACTORING_FEE_PCT * 100}%)`} value={formatCurrency(settlements.reduce((s, x) => s + x.factoringFee, 0))} sublabel="vs. 30-45 day broker terms" /></CardContent></Card>
      </div>

      <p className="text-xs text-ink-400">
        Free to you. Backroute earns {formatCurrency(backrouteCommission)} in referral commission from our factoring partner on these invoices, not charged to you.
      </p>

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
  if (loads.length === 0) return <EmptyState text="No delivered loads yet. Pay statements appear the moment a load delivers." />;

  const rows = loads
    .flatMap((l) => {
      const truck = l.truckId ? trucks.get(l.truckId) : undefined;
      if (!truck) return [];
      const isTeam = !!truck.secondDriverId;
      const primary = truck.driverId ? drivers.get(truck.driverId) : undefined;
      const second = truck.secondDriverId ? drivers.get(truck.secondDriverId) : undefined;
      return [
        primary ? { load: l, driver: primary, pay: computeDriverPay(l, primary, isTeam) } : null,
        second ? { load: l, driver: second, pay: computeDriverPay(l, second, isTeam) } : null,
      ];
    })
    .filter((r): r is { load: Load; driver: Driver; pay: number } => r !== null);

  const totalPay = rows.reduce((s, r) => s + r.pay, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            downloadCsv(
              `settlements-driver-pay-${new Date().toISOString().slice(0, 10)}.csv`,
              ["Driver", "Lane", "Reference", "Pay Type", "Pay Rate", "Pay"],
              rows.map((r) => [
                r.driver.name,
                `${r.load.lane.origin} → ${r.load.lane.destination}`,
                r.load.referenceNumber,
                r.driver.payType,
                r.driver.payRate,
                r.pay,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <Card><CardContent><StatTile label="Total driver pay" value={formatCurrency(totalPay)} sublabel={`${rows.length} loads`} /></CardContent></Card>

      <div className="flex flex-col gap-2">
        {rows.map(({ load, driver, pay }) => (
          <div key={`${load.id}-${driver.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
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
