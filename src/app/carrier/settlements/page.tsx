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
import { useBrokerMap, useCarrierLoads, useDriverMap, useTruckMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { computeDriverPay, FACTORING_FEE_PCT, payLabel } from "@/lib/settlements";
import { paymentStatus, type PaymentState } from "@/lib/payments";
import { computeFactoringCommission } from "@/lib/commissions";
import { downloadCsv } from "@/lib/csv-export";
import { cn, formatCurrency } from "@/lib/utils";
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
  const [tab, setTab] = useState<"payments" | "driver-pay" | "expenses">("payments");

  const delivered = loads.filter((l) => l.stage === "delivered");
  const pendingExpenseCount = expenses.filter((e) => e.status === "pending").length;

  return (
    <div>
      <PageHeader title="Settlements" description={`${delivered.length} delivered loads`} />

      <div className="px-4 py-6 sm:px-8">
        <Tabs
          tabs={[
            { key: "payments", label: "Payments", count: delivered.length },
            { key: "driver-pay", label: "Driver pay", count: delivered.length },
            { key: "expenses", label: "Expenses", count: pendingExpenseCount || undefined },
          ]}
          active={tab}
          onChange={(k) => setTab(k as "payments" | "driver-pay" | "expenses")}
        />

        <div className="mt-5">
          {tab === "payments" && <PaymentsList loads={delivered} now={now} />}
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

function PaymentsList({ loads, now }: { loads: Load[]; now: number | null }) {
  const brokers = useBrokerMap();
  const factoringOn = useStore((s) => s.settings.enabledAddons.includes("factoring-ai"));
  const toggleAddon = useStore((s) => s.actions.toggleAddon);
  if (loads.length === 0) return <EmptyState text="No delivered loads yet. Each one shows up here the moment its POD checks out." />;
  if (now === null) return null;

  const rows = loads
    .map((l) => ({ load: l, broker: brokers.get(l.brokerId), p: paymentStatus(l, brokers.get(l.brokerId), factoringOn, now) }))
    .sort((a, b) => Date.parse(b.load.updatedAt) - Date.parse(a.load.updatedAt));
  const sum = (states: string[]) => rows.filter((r) => states.includes(r.p.state)).reduce((s, r) => s + r.p.payout, 0);
  const count = (states: string[]) => rows.filter((r) => states.includes(r.p.state)).length;
  const backrouteCommission = rows.filter((r) => r.p.method === "factoring").reduce((s, r) => s + computeFactoringCommission(r.p.invoiceAmount), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-500">
          {factoringOn
            ? `Factoring on: the AI submits each invoice packet to the factoring partner (${FACTORING_FEE_PCT * 100}% fee, recourse). Brokers the factor won't buy are invoiced directly.`
            : "Factoring off: the AI invoices each broker directly on Net 30 and follows up when a payment is late."}
          {!factoringOn && (
            <button type="button" onClick={() => toggleAddon("factoring-ai")} className="ml-1.5 font-medium text-ink-950 underline">
              Turn on factoring
            </button>
          )}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            downloadCsv(
              `settlements-payments-${new Date().toISOString().slice(0, 10)}.csv`,
              ["Lane", "Reference", "Method", "Invoice Amount", "Fee", "Payout", "Status"],
              rows.map((r) => [`${r.load.lane.origin} → ${r.load.lane.destination}`, r.load.referenceNumber, r.p.method, r.p.invoiceAmount, r.p.fee, r.p.payout, r.p.headline]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card><CardContent><StatTile label="Funding soon" value={formatCurrency(sum(["submitted"]))} sublabel={`${count(["submitted"])} with the factor`} /></CardContent></Card>
        <Card><CardContent><StatTile label="Paid" value={formatCurrency(sum(["funded", "paid"]))} sublabel={`${count(["funded", "paid"])} invoices`} /></CardContent></Card>
        <Card><CardContent><StatTile label="Waiting on brokers" value={formatCurrency(sum(["invoiced"]))} sublabel={`${count(["invoiced"])} on Net 30`} /></CardContent></Card>
        <Card><CardContent><StatTile label="Overdue or on hold" value={formatCurrency(sum(["overdue", "held"]))} sublabel={`${count(["overdue", "held"])} the AI is chasing`} /></CardContent></Card>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map(({ load, broker, p }) => (
          <details key={load.id} className="group rounded-2xl border border-line bg-white p-4">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink-950">{load.lane.origin} → {load.lane.destination}</p>
                <p className="text-xs text-ink-400">
                  {load.referenceNumber} · {broker?.company ?? "Broker"} · {p.method === "factoring" ? "Factoring" : "Direct invoice"}
                  {p.fee ? ` · ${formatCurrency(p.fee)} fee` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold tabular text-ink-950">{formatCurrency(p.payout)}</p>
                <Badge tone={PAYMENT_TONE[p.state]}>
                  {p.state === "funded" || p.state === "paid" ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {p.headline}
                </Badge>
              </div>
            </summary>
            <ol className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              {p.steps.map((step) => (
                <li key={step.label} className="flex gap-2.5 text-xs">
                  <span
                    className={cn(
                      "mt-1 h-2 w-2 shrink-0 rounded-full",
                      step.state === "done" ? "bg-[var(--accent-live)]" : step.state === "problem" ? "bg-[var(--accent-danger)]" : step.state === "current" ? "bg-[var(--accent-warn)]" : "bg-ink-200",
                    )}
                  />
                  <span>
                    <span className="font-medium text-ink-900">{step.label}</span>
                    {step.detail && <span className="text-ink-500"> · {step.detail}</span>}
                  </span>
                </li>
              ))}
              {p.factorDeclined && <li className="text-xs text-ink-500">{p.factorDeclined}, so the AI invoiced them directly.</li>}
              {p.pendingExtras > 0 && <li className="text-xs text-ink-500">{formatCurrency(p.pendingExtras)} in extras is still waiting on the broker&apos;s OK and goes on a follow-up invoice.</li>}
            </ol>
          </details>
        ))}
      </div>

      {backrouteCommission > 0 && (
        <p className="text-xs text-ink-400">
          Backroute earns {formatCurrency(backrouteCommission)} in referral commission from the factoring partner on these invoices. It isn&apos;t taken from your payout.
        </p>
      )}
    </div>
  );
}

const PAYMENT_TONE: Record<PaymentState, "success" | "warning" | "danger" | "neutral" | "info"> = {
  held: "danger",
  submitted: "warning",
  funded: "success",
  invoiced: "info",
  overdue: "danger",
  paid: "success",
};

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
              <p className="text-[11px] text-ink-400">{payLabel(driver)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
