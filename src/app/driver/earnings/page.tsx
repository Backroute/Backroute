"use client";

import Link from "next/link";
import { ArrowUpRight, Clock, Gauge, Sparkles, Timer, TrendingUp } from "lucide-react";
import { usePrimaryDriver, useCarrierTrucks, useCarrierLoads } from "@/lib/selectors";
import { computeDriverPay } from "@/lib/settlements";
import { weekEarnings } from "@/lib/earnings";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";

const INDUSTRY_EMPTY_PCT = 20;

export default function DriverEarningsPage() {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const team = !!truck?.secondDriverId;
  const week = weekEarnings(loads.filter((l) => l.truckId === truck?.id));
  const payFor = (l: (typeof week.loads)[number]) => computeDriverPay(l, driver, team);
  const pay = week.loads.reduce((s, l) => s + payFor(l), 0);
  const payByDay = week.byDay.map((d) => ({ ...d, pay: 0 }));
  for (const l of week.loads) payByDay[(new Date(l.createdAt).getDay() + 6) % 7].pay += payFor(l);
  const maxDay = Math.max(1, ...payByDay.map((d) => d.pay));
  const today = (new Date().getDay() + 6) % 7;
  const sorted = [...week.loads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <div className="flex flex-col gap-5 px-5">
      <div>
        <h1 className="font-display text-2xl text-ink-950">Earnings</h1>
        <p className="mt-1 text-sm text-ink-500">This week, from every load the AI booked for you.</p>
      </div>

      <section className="rounded-3xl bg-ink-950 p-5 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Your pay this week</p>
        <p className="mt-1 text-4xl font-semibold tabular tracking-tight">{formatCurrency(pay)}</p>
        <p className="mt-1 text-xs text-white/55">
          {driver.payType === "percentage" ? `${Math.round(driver.payRate * 100)}% of each load` : `$${driver.payRate.toFixed(2)} per loaded mile`}
          {team ? " · split with your team partner" : ""}
        </p>
        {week.overMarket > 0 && (
          <p className="mt-3 flex items-center gap-1.5 rounded-2xl bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-200">
            <TrendingUp className="h-3.5 w-3.5 shrink-0" /> AI booked your loads {formatCurrency(week.overMarket)} above market rate
          </p>
        )}

        <div className="mt-5 flex h-28 gap-2" role="img" aria-label="Pay by day this week">
          {payByDay.map((d, i) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 items-end">
                <div
                  className={cn("w-full rounded-t-md transition-[height] duration-700", i === today ? "bg-white" : "bg-white/25")}
                  style={{ height: `${Math.max(4, (d.pay / maxDay) * 100)}%` }}
                  title={formatCurrency(d.pay)}
                />
              </div>
              <span className={cn("text-[10px]", i === today ? "font-semibold text-white" : "text-white/45")}>{d.day}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Loads" value={week.loads.length} />
        <Stat label="Miles" value={formatNumber(week.loadedMiles + week.emptyMiles)} />
        <Stat label="Per mile, all miles" value={`$${week.rpmAll.toFixed(2)}`} />
      </div>

      <section className="rounded-3xl border border-line p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
          <Sparkles className="h-4 w-4" /> Where the AI made you money
        </h2>
        <ul className="mt-3 flex flex-col divide-y divide-line">
          <Row icon={TrendingUp} label="Negotiated above posted rates" value={`+${formatCurrency(week.overPosted)}`} good />
          <Row icon={Timer} label="Detention billed for you" value={week.extras ? `+${formatCurrency(week.extras)}` : "None this week"} good={week.extras > 0} />
          <Row
            icon={Gauge}
            label="Empty miles"
            value={`${week.emptyPct.toFixed(0)}%`}
            sub={`Industry average is ~${INDUSTRY_EMPTY_PCT}%. The AI books your next load near where you deliver.`}
            good={week.emptyPct < INDUSTRY_EMPTY_PCT}
          />
          <Row icon={Clock} label="Dispatcher work done for you" value={`${week.hoursSaved} hrs`} sub="Broker calls, emails, rate cons, check calls and paperwork." />
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-950">Loads this week</h2>
        {sorted.length === 0 ? (
          <p className="rounded-2xl border border-line px-4 py-6 text-center text-sm text-ink-500">No booked loads yet this week. The AI is on it.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((l) => (
              <li key={l.id}>
                <Link href={`/driver/loads/${l.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-950">
                      {l.lane.origin} → {l.lane.destination}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatDate(l.createdAt)} · {l.lane.miles} mi · {formatCurrency(l.bookedRate ?? 0)} load
                      {l.stage !== "delivered" ? " · in progress" : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular text-ink-950">
                    {formatCurrency(payFor(l))} <ArrowUpRight className="h-3.5 w-3.5 text-ink-400" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-line p-3.5 text-center">
      <p className="font-display text-xl tabular text-ink-950">{value}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-ink-500">{label}</p>
    </div>
  );
}

function Row({ icon: Icon, label, value, sub, good }: { icon: typeof Clock; label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-800">{label}</p>
        {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
      </div>
      <span className={cn("shrink-0 text-sm font-semibold tabular", good ? "text-[var(--accent-live)]" : "text-ink-950")}>{value}</span>
    </li>
  );
}
