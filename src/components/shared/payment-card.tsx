"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { paymentStatus } from "@/lib/payments";
import { cn, formatCurrency } from "@/lib/utils";
import type { Load } from "@/lib/types";

/** Where the money for one delivered load is, step by step. */
export function PaymentCard({ load }: { load: Load }) {
  const now = useNow();
  const broker = useStore((s) => s.brokers.find((b) => b.id === load.brokerId));
  const factoringOn = useStore((s) => s.settings.enabledAddons.includes("factoring-ai"));
  if (now === null || load.stage !== "delivered") return null;
  const p = paymentStatus(load, broker, factoringOn, now);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting paid</CardTitle>
        <span className="text-xs font-medium text-ink-500">{p.headline}</span>
      </CardHeader>
      <CardContent className="!pt-3">
        <ol className="flex flex-col gap-2.5">
          {p.steps.map((step) => (
            <li key={step.label} className="flex gap-2.5 text-xs">
              <span
                className={cn(
                  "mt-1 h-2 w-2 shrink-0 rounded-full",
                  step.state === "done" ? "bg-[var(--accent-live)]" : step.state === "problem" ? "bg-[var(--accent-danger)]" : step.state === "current" ? "bg-[var(--accent-warn)]" : "bg-ink-200",
                )}
              />
              <span>
                <span className="block font-medium text-ink-900">{step.label}</span>
                {step.detail && <span className="text-ink-500">{step.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
          <span className="text-ink-500">{p.fee ? `${formatCurrency(p.invoiceAmount)} − ${formatCurrency(p.fee)} fee` : "Invoice"}</span>
          <span className="font-semibold tabular text-ink-950">{formatCurrency(p.payout)}</span>
        </div>
        {p.factorDeclined && <p className="mt-2 text-xs text-ink-500">{p.factorDeclined}, so the AI invoiced them directly.</p>}
      </CardContent>
    </Card>
  );
}
