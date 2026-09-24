"use client";

import { Info } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Badge } from "@/components/ui/badge";
import { BrokerTrustBadge } from "@/components/shared/broker-trust-badge";
import { useCarrierLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { POLICY_LABEL, STANDARD_TERMS_DAYS, assessBroker, type BrokerPolicy } from "@/lib/broker-policy";
import { cn } from "@/lib/utils";

const POLICY_TONE: Record<BrokerPolicy, "success" | "warning" | "danger"> = { normal: "success", surcharge: "warning", block: "danger" };
const POLICY_ORDER: Record<BrokerPolicy, number> = { block: 0, surcharge: 1, normal: 2 };

export default function BrokersPage() {
  const brokers = useStore((s) => s.brokers);
  const overrides = useStore((s) => s.settings.brokerOverrides);
  const setBrokerPolicy = useStore((s) => s.actions.setBrokerPolicy);
  const loads = useCarrierLoads();

  const rows = brokers
    .map((b) => ({
      broker: b,
      a: assessBroker(b, overrides),
      booked: loads.filter((l) => l.brokerId === b.id && l.bookedRate !== null && l.stage !== "cancelled").length,
    }))
    .sort((x, y) => POLICY_ORDER[x.a.policy] - POLICY_ORDER[y.a.policy] || x.broker.avgDaysToPay - y.broker.avgDaysToPay);
  const counts = { block: 0, surcharge: 0, normal: 0 };
  for (const r of rows) counts[r.a.policy] += 1;

  return (
    <div>
      <PageHeader title="Brokers" description="How each broker pays and treats carriers, and how the AI deals with them." />
      <div className="flex flex-col gap-5 px-4 py-6 sm:px-8">
        <div className="grid grid-cols-3 gap-3">
          <Summary label="Book normally" value={counts.normal} tone="text-[var(--accent-live)]" />
          <Summary label="Ask more to cover slow pay" value={counts.surcharge} tone="text-[var(--accent-warn)]" />
          <Summary label="AI won't book" value={counts.block} tone="text-[var(--accent-danger)]" />
        </div>

        <p className="flex items-start gap-2 rounded-2xl bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-600">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Days to pay and detention history come from your own invoices plus the factoring partner&apos;s broker credit data. The AI can&apos;t make a
          broker pay faster. It can only avoid them or ask for more to cover the wait, and some brokers will give the load to another carrier instead.
        </p>

        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map(({ broker: b, a, booked }) => (
            <div key={b.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">{b.company}</p>
                  <p className="text-xs text-ink-500">{b.contact} · {booked} load{booked === 1 ? "" : "s"} with you</p>
                  <BrokerTrustBadge broker={b} className="mt-1" />
                </div>
                <Badge tone={POLICY_TONE[a.policy]}>{POLICY_LABEL[a.policy]}</Badge>
              </div>

              <dl className="grid grid-cols-3 gap-2">
                <Metric label="Days to pay" value={`${b.avgDaysToPay}`} bad={b.avgDaysToPay > 40} sub={`terms ${STANDARD_TERMS_DAYS}`} />
                <Metric label="Detention paid" value={`${b.detentionPaidPct}%`} bad={b.detentionPaidPct < 50} />
                <Metric label="Cancellations, 90 days" value={`${b.cancellations90d}`} bad={b.cancellations90d >= 3} />
              </dl>

              {a.reasons.length > 0 && (
                <ul className="flex flex-col gap-1 text-xs text-ink-600">
                  {a.reasons.map((r) => (
                    <li key={r} className="flex gap-1.5">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-400" /> {r}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <label htmlFor={`policy-${b.id}`} className="text-xs text-ink-500">
                  {a.overridden ? `Your call. The AI would ${POLICY_LABEL[a.auto].toLowerCase()}.` : "AI's call from this record"}
                </label>
                <select
                  id={`policy-${b.id}`}
                  value={overrides[b.id] ?? "auto"}
                  onChange={(e) => setBrokerPolicy(b.id, e.target.value === "auto" ? null : (e.target.value as BrokerPolicy))}
                  className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-800 outline-none focus:border-ink-400"
                >
                  <option value="auto">Let the AI decide ({POLICY_LABEL[a.auto].toLowerCase()})</option>
                  <option value="normal">{POLICY_LABEL.normal}</option>
                  <option value="surcharge">{POLICY_LABEL.surcharge}</option>
                  <option value="block">{POLICY_LABEL.block}</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className={cn("font-display text-2xl tabular", tone)}>{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{label}</p>
    </div>
  );
}

function Metric({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-ink-50 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-semibold tabular", bad ? "text-[var(--accent-danger)]" : "text-ink-950")}>
        {value}
        {sub && <span className="ml-1 text-[10px] font-normal text-ink-400">{sub}</span>}
      </dd>
    </div>
  );
}
