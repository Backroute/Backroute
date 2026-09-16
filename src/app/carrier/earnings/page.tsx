"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { usePrimaryCarrier, useCarrierLoads, useCarrierTrucks } from "@/lib/selectors";
import { formatCurrency } from "@/lib/utils";

const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];

export default function EarningsPage() {
  const carrier = usePrimaryCarrier();
  const loads = useCarrierLoads();
  const trucks = useCarrierTrucks();

  const delivered = loads.filter((l) => l.stage === "delivered");
  const netProfitTotal = loads.reduce((s, l) => s + (l.netProfit ?? 0), 0);
  const avgRpm = (() => {
    const withRpm = loads.filter((l) => l.rpm);
    return withRpm.length ? withRpm.reduce((s, l) => s + (l.rpm ?? 0), 0) / withRpm.length : 0;
  })();
  const deadheadMiles = loads.reduce((s, l) => s + l.deadheadMiles, 0);
  const totalMiles = loads.reduce((s, l) => s + l.lane.miles, 0) + deadheadMiles;
  const emptyRate = totalMiles ? (deadheadMiles / totalMiles) * 100 : 0;

  const revenueTrend = MONTHS.map((m, i) => ({
    month: m,
    revenue: Math.round(carrier.gmvMonth * (0.72 + i * 0.052)),
    saved: Math.round(carrier.avgSavingsPerTruck * trucks.length * (0.68 + i * 0.06)),
  }));

  const costComparison = [
    { name: "Industry avg", value: 1500 },
    { name: "Backroute", value: 539 },
  ];

  return (
    <div>
      <PageHeader title="Earnings" />

      <div className="flex flex-col gap-6 px-8 py-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card><CardContent><StatTile label="Net profit" value={formatCurrency(netProfitTotal)} sublabel="This cycle" /></CardContent></Card>
          <Card><CardContent><StatTile label="Avg rate / mile" value={`$${avgRpm.toFixed(2)}`} /></CardContent></Card>
          <Card><CardContent><StatTile label="Loads delivered" value={delivered.length} /></CardContent></Card>
          <Card><CardContent><StatTile label="Empty-mile rate" value={`${emptyRate.toFixed(1)}%`} sublabel="Industry avg is ~20%" trend={{ direction: "down", value: "chained loads cut this", good: true }} /></CardContent></Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Revenue & savings trend</CardTitle>
            </CardHeader>
            <CardContent className="!pt-4">
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueTrend} margin={{ left: -12, right: 12, top: 8 }}>
                    <CartesianGrid stroke="#e4e4e0" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} />
                    <YAxis yAxisId="revenue" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} width={48} />
                    <YAxis yAxisId="saved" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#0f8a4b" }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} width={48} />
                    <Tooltip
                      formatter={(value, key) => [formatCurrency(Number(value)), key === "revenue" ? "GMV" : "Saved vs. human dispatch"]}
                      contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e0", fontSize: 12 }}
                    />
                    <Line yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#0a0a0a" strokeWidth={2} dot={false} />
                    <Line yAxisId="saved" type="monotone" dataKey="saved" stroke="#0f8a4b" strokeWidth={2} dot={false} strokeDasharray="4 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cost per truck / month</CardTitle>
            </CardHeader>
            <CardContent className="!pt-4">
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costComparison} margin={{ left: -12, right: 12, top: 8 }}>
                    <CartesianGrid stroke="#e4e4e0" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} tickFormatter={(v) => `$${v}`} width={48} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e0", fontSize: 12 }} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#0a0a0a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-xs text-ink-500">
                About <span className="font-medium text-ink-900">{formatCurrency(1500 - 539)}</span> saved per truck, per month — {formatCurrency((1500 - 539) * trucks.length)} across your fleet.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
