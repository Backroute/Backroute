"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authHeader } from "@/lib/ai/client";
import { formatCurrency } from "@/lib/utils";

interface BillingView {
  configured: boolean;
  status?: "none" | "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete";
  trucks?: number;
  billedTrucks?: number;
  trialEnd?: string | null;
  periodEnd?: string | null;
  cancelAt?: string | null;
  pastDueSince?: string | null;
  hold?: string | null;
  trialDays?: number;
  pricePerTruck?: number | null;
  invoices?: { id: string; number: string | null; amount: number; status: string; created: string; url: string | null; pdf: string | null }[];
}

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/**
 * The carrier's Backroute subscription: what it costs, where it stands, and the invoices. Cards and cancelling are
 * on Stripe's own pages, so card numbers never touch Backroute.
 */
export function BillingCard() {
  const [b, setB] = useState<BillingView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/billing", { headers: await authHeader() });
      if (res.ok) setB((await res.json()) as BillingView);
    } catch {
      setError("Couldn't load billing. Check your connection.");
    }
  }, []);
  useEffect(() => {
    // Loaded once the tab opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function go(op: "checkout" | "portal") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ op }) });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (body.url) {
        window.location.assign(body.url);
        return;
      }
      setError(body.error === "owner_only" ? "Only the owner can change billing." : "Couldn't open billing. Try again.");
    } catch {
      setError("Couldn't open billing. Try again.");
    }
    setBusy(false);
  }

  if (!b) return <Card><CardContent className="!py-6 text-sm text-ink-500">{error ?? "Loading billing…"}</CardContent></Card>;
  if (!b.configured)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
          <CardDescription>Not set up yet: you aren&apos;t being charged.</CardDescription>
        </CardHeader>
      </Card>
    );

  const subscribed = b.status === "active" || b.status === "trialing" || b.status === "past_due";
  const line =
    b.status === "trialing"
      ? `Free trial until ${day(b.trialEnd)}. Then ${b.billedTrucks || b.trucks} truck${(b.billedTrucks || b.trucks) === 1 ? "" : "s"} a month.`
      : b.status === "active"
        ? `${b.billedTrucks} truck${b.billedTrucks === 1 ? "" : "s"} · renews ${day(b.periodEnd)}${b.cancelAt ? ` · ends ${day(b.cancelAt)}` : ""}`
        : b.status === "past_due"
          ? `Your card didn't go through${b.pastDueSince ? ` on ${day(b.pastDueSince)}` : ""}. Update it to keep the AI booking.`
          : b.status === "canceled"
            ? "Your subscription ended."
            : `Start with ${b.trialDays} days free. You're billed per truck, ${b.trucks} now.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>
          Per truck, per month{b.pricePerTruck ? ` (${formatCurrency(b.pricePerTruck)})` : ""}. Trucks you add or remove change the next bill. Cards and invoices are handled by Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-600">
              <CreditCard className="h-4 w-4" />
            </span>
            <p className="text-sm text-ink-800">{line}</p>
          </div>
          <Button size="sm" variant={subscribed ? "outline" : "primary"} disabled={busy} onClick={() => void go(subscribed ? "portal" : "checkout")}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {subscribed ? "Manage billing" : b.status === "canceled" ? "Start again" : "Start subscription"}
          </Button>
        </div>
        {b.hold && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-ink-700">The AI isn&apos;t booking new loads: {b.hold}. Loads already booked keep running.</p>}
        {b.invoices?.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {b.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-ink-700">
                  {day(i.created)} · {formatCurrency(i.amount)} · <span className="text-ink-500">{i.status}</span>
                </span>
                {(i.url || i.pdf) && (
                  <a href={i.url ?? i.pdf!} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-ink-600 hover:text-ink-950">
                    Invoice <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {error && <p className="text-xs text-[var(--accent-danger)]">{error}</p>}
      </CardContent>
    </Card>
  );
}
