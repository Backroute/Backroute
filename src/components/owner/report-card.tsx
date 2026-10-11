"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStore } from "@/lib/store";
import { useCarrierEscalations, useCarrierLoads } from "@/lib/selectors";
import { useNow } from "@/lib/hooks";
import { reportCard } from "@/lib/report-card";
import { formatCurrency } from "@/lib/utils";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Backroute as the carrier's dispatcher, the last 30 days, judged the way an owner judges a person in the job. Only
 * from the carrier's own records; what there's nothing behind yet shows as "not yet".
 */
export function ReportCardPanel() {
  const loads = useCarrierLoads();
  const escalations = useCarrierEscalations();
  const goal = useStore((s) => s.settings.weeklyGoal);
  const trucks = useStore((s) => s.trucks.length);
  const now = useNow();
  if (now === null) return null;
  const r = reportCard(loads, escalations, now);
  const rows: { label: string; value: string; note?: string }[] = [
    { label: "Loads delivered", value: String(r.delivered), note: `${r.bookedByAi} booked by Backroute, ${r.bookedByOwner} by you or a driver` },
    { label: "Revenue", value: formatCurrency(r.revenue), note: r.rpm ? `$${r.rpm.toFixed(2)} a loaded mile${r.before ? ` · before Backroute: $${r.before.rpm.toFixed(2)} (${r.before.loads} past loads)` : ""}` : undefined },
    { label: "Against the market", value: r.vsMarket ? `${r.vsMarket.cents >= 0 ? "+" : ""}${r.vsMarket.cents}¢ a mile` : "Not yet", note: r.vsMarket ? `On ${r.vsMarket.loads} loads with a market rate` : "Needs the rate data service connected" },
    { label: "Extra pay collected", value: formatCurrency(r.extras.amount), note: `${r.extras.claims} detention, layover and TONU claims sent` },
    { label: "Invoiced within a day", value: r.invoicedSameDay ? pct(r.invoicedSameDay.share) : "Not yet", note: r.invoicedSameDay ? `of ${r.invoicedSameDay.of} invoices` : undefined },
    { label: "Days to get paid", value: r.daysToPaid !== null ? String(r.daysToPaid) : "Not yet" },
    { label: "On time", value: r.onTime ? pct(r.onTime.share) : "Not yet", note: r.onTime ? `of ${r.onTime.of} deliveries with an appointment` : undefined },
    { label: "Empty between loads", value: r.emptyHours !== null ? `${r.emptyHours} h` : "Not yet", note: "From one delivery to the next pickup, on average" },
    { label: "Times it asked you", value: String(r.askedOwner) },
  ];
  const weekly = goal && trucks ? goal * trucks : null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>How Backroute did, last 30 days</CardTitle>
          <CardDescription>The numbers you&apos;d judge a dispatcher by, from your own loads.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map((x) => (
            <div key={x.label} className="flex flex-col">
              <dt className="text-xs text-ink-500">{x.label}</dt>
              <dd className="text-base font-semibold tabular text-ink-950">{x.value}</dd>
              {x.note && <dd className="text-xs text-ink-500">{x.note}</dd>}
            </div>
          ))}
        </dl>
        {weekly && (
          <p className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-700">
            Your goal: {formatCurrency(goal!)} a truck a week ({formatCurrency(weekly)} for the fleet). Last 30 days averaged {formatCurrency(Math.round((r.revenue / 30) * 7))} a week.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
