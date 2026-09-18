"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { useStore } from "@/lib/store";
import { computeFactoringCommission, INSURANCE_REFERRAL_FEE, IFTA_FILING_FEE } from "@/lib/commissions";
import { formatCompact, formatCurrency } from "@/lib/utils";

/**
 * Platform-wide adoption/usage is estimated — only the primary carrier's own toggles and loads are real store state.
 * The AI add-ons themselves are free; this is what Backroute earns from partner referrals and flat filing fees instead.
 */
const FACTORING_ADOPTION_PCT = 0.54;
const INSURANCE_ADOPTION_PCT = 0.18;
const FILING_ADOPTION_PCT = 0.22;
/** Assumed share of an average carrier's monthly freight that gets factored through the partner. */
const AVG_FACTORED_GMV_SHARE = 0.35;

const TRAJECTORY = [
  { year: "Year 1", revenue: 0.6, detail: "80 carriers · ~100 trucks" },
  { year: "Year 2", revenue: 3.5, detail: "400 carriers · ~550 trucks" },
  { year: "Year 3", revenue: 13, detail: "1,200 carriers · ~1,900 trucks" },
  { year: "Year 4", revenue: 36, detail: "3,000 carriers · ~5,400 trucks" },
  { year: "Year 5", revenue: 109, detail: "8,000 carriers · ~16k trucks" },
];

const PLAN_COLORS: Record<string, string> = { Starter: "#c6c6c0", Growth: "#55554f", Fleet: "#0a0a0a" };

export default function RevenuePage() {
  const carriers = useStore((s) => s.carriers);

  const takeRate = carriers.reduce((s, c) => s + c.takeRateRevenue, 0);
  const mrr = carriers.reduce((s, c) => s + c.mrr, 0);
  const gmv = carriers.reduce((s, c) => s + c.gmvMonth, 0);

  const avgGmvPerCarrier = carriers.length ? gmv / carriers.length : 0;
  const factoringAdopters = Math.round(carriers.length * FACTORING_ADOPTION_PCT);
  const factoringCommissionRevenue = factoringAdopters * computeFactoringCommission(avgGmvPerCarrier * AVG_FACTORED_GMV_SHARE);

  const insuranceAdopters = Math.round(carriers.length * INSURANCE_ADOPTION_PCT);
  const insuranceCommissionRevenue = Math.round((insuranceAdopters * INSURANCE_REFERRAL_FEE) / 12);

  const filingAdopters = Math.round(carriers.length * FILING_ADOPTION_PCT);
  const iftaFilingRevenue = Math.round((filingAdopters * IFTA_FILING_FEE) / 3);

  const commissionBreakdown = [
    { id: "factoring-ai", name: "Factoring AI", detail: `${factoringAdopters} carriers · referral commission`, revenue: factoringCommissionRevenue },
    { id: "insurance-ai", name: "Insurance AI", detail: `${insuranceAdopters} carriers · referral fee, amortized`, revenue: insuranceCommissionRevenue },
    { id: "compliance-ai", name: "IFTA filing", detail: `${filingAdopters} carriers · $${IFTA_FILING_FEE}/quarter`, revenue: iftaFilingRevenue },
  ];
  const commissionRevenue = commissionBreakdown.reduce((s, a) => s + a.revenue, 0);

  const planMix = ["Starter", "Growth", "Fleet"].map((plan) => ({
    name: plan,
    value: carriers.filter((c) => c.plan === plan).length,
  }));
  // recharts' <Pie> stopped sweeping a full 360° in this project (v3.10.1 renders roughly half a
  // ring, cause unconfirmed upstream) — a plain conic-gradient donut is simpler and can't have that
  // bug, so it replaces the chart for this one widget.
  const planMixTotal = planMix.reduce((s, p) => s + p.value, 0) || 1;
  let planMixCursor = 0;
  const planMixGradient = planMix
    .map((p) => {
      const start = planMixCursor;
      planMixCursor += (p.value / planMixTotal) * 100;
      return `${PLAN_COLORS[p.name]} ${start}% ${planMixCursor}%`;
    })
    .join(", ");

  return (
    <div>
      <PageHeader title="Revenue" description="Subscription + 2% take-rate" />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Card><CardContent><StatTile label="Total revenue / mo" value={formatCurrency(mrr + takeRate + commissionRevenue)} /></CardContent></Card>
          <Card><CardContent><StatTile label="Subscription MRR" value={formatCurrency(mrr)} /></CardContent></Card>
          <Card><CardContent><StatTile label="Take-rate (2%)" value={formatCurrency(takeRate)} /></CardContent></Card>
          <Card><CardContent><StatTile label="Commission & filing revenue" value={formatCurrency(commissionRevenue)} /></CardContent></Card>
          <Card><CardContent><StatTile label="GMV / mo" value={`$${formatCompact(gmv)}`} /></CardContent></Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Revenue growth</CardTitle>
              <p className="text-xs text-ink-400">Targets, not actuals</p>
            </CardHeader>
            <CardContent className="!pt-4">
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={TRAJECTORY} margin={{ left: -12, right: 12, top: 8 }}>
                    <CartesianGrid stroke="#e4e4e0" vertical={false} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#9d9d95" }} tickFormatter={(v) => `$${v}M`} width={48} />
                    <Tooltip
                      formatter={(value) => [`$${value}M`, "Revenue"]}
                      labelFormatter={(label, payload) => `${label} — ${payload?.[0]?.payload?.detail ?? ""}`}
                      contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e0", fontSize: 12 }}
                    />
                    <Bar dataKey="revenue" radius={[8, 8, 0, 0]} fill="#0a0a0a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plan mix</CardTitle>
            </CardHeader>
            <CardContent className="!pt-4">
              <div className="flex h-56 w-full items-center justify-center">
                <div className="relative h-40 w-40 rounded-full" style={{ background: `conic-gradient(${planMixGradient})` }}>
                  <div className="absolute inset-[25px] rounded-full bg-white" />
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {planMix.map((p) => (
                  <div key={p.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-ink-600">
                      <span className="h-2 w-2 rounded-full" style={{ background: PLAN_COLORS[p.name] }} />
                      {p.name}
                    </span>
                    <span className="tabular text-ink-500">{p.value} carriers</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Partner commission & filing revenue</CardTitle>
              <CardDescription>Estimated platform-wide — AI add-ons are free to carriers; this is what Backroute earns instead.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            <div className="flex flex-col divide-y divide-line">
              {commissionBreakdown
                .sort((a, b) => b.revenue - a.revenue)
                .map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-900">{a.name}</p>
                      <p className="text-xs text-ink-400">{a.detail}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular text-ink-950">{formatCurrency(a.revenue)}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
