"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { TrackPanel } from "@/components/shared/track-panel";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { trackView, type TrackView } from "@/lib/track-view";
import { formatCurrency } from "@/lib/utils";

type Row = TrackView & { invoice: { number: string; amount: number; sentAt: string; paidAt: string | null } | null };
interface Portal {
  customer: string;
  carrier: string;
  /** The carrier's MC number, when it's on file. */
  mc?: string | null;
  loads: Row[];
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * A direct shipper's page of their loads with the carrier: what's moving and where, what's delivered with the signed
 * POD, and each invoice. No sign-in; the link is the key, and it expires. A sample account's link reads this browser.
 */
export default function ShipperPage() {
  const { token } = useParams<{ token: string }>();
  const demoId = token.startsWith("demo-") ? token.slice(5) : null;
  const loads = useStore((s) => s.loads);
  const trucks = useStore((s) => s.trucks);
  const brokers = useStore((s) => s.brokers);
  const carriers = useStore((s) => s.carriers);
  const now = useNow();
  const [data, setData] = useState<Portal | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "gone">("loading");

  useEffect(() => {
    if (demoId) return;
    let stop = false;
    const read = async () => {
      const res = await fetch(`/api/shipper?t=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (res?.ok) {
        setData((await res.json()) as Portal);
        setState("ok");
      } else if (res && res.status !== 429) setState("gone");
    };
    void read();
    const id = setInterval(() => void read(), 120_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [demoId, token]);

  let portal: Portal | null = data;
  if (demoId && now !== null) {
    const customer = brokers.find((b) => b.id === demoId);
    if (customer) {
      const rows = loads
        .filter((l) => l.brokerId === demoId)
        .map((l) => {
          const v = trackView(l, trucks.find((t) => t.id === l.truckId), carriers[0]?.name ?? "Sample carrier", now);
          return v ? { ...v, invoice: l.invoice?.sentAt ? { number: l.invoice.number, amount: l.invoice.amount, sentAt: l.invoice.sentAt, paidAt: l.invoice.paidAt ?? null } : null } : null;
        })
        .filter((x): x is Row => !!x);
      portal = { customer: customer.company, carrier: carriers[0]?.name ?? "Sample carrier", loads: rows };
    }
  }

  const moving = portal?.loads.filter((l) => l.step !== "delivered" && l.step !== "cancelled") ?? [];
  const done = portal?.loads.filter((l) => l.step === "delivered") ?? [];
  const invoices = portal?.loads.filter((l) => l.invoice) ?? [];
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      {portal ? (
        <>
          <header>
            <p className="text-sm text-ink-500">
              {portal.carrier}
              {portal.mc && ` · ${/^mc/i.test(portal.mc) ? portal.mc : `MC ${portal.mc}`}`}
              {demoId && " · sample"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink-950">{portal.customer}&apos;s loads</h1>
          </header>
          <section className="flex flex-col gap-3" aria-label="Moving now">
            <h2 className="text-sm font-semibold text-ink-950">Moving now</h2>
            {moving.length ? moving.map((l) => <TrackPanel key={l.ref} view={l} compact />) : <p className="text-sm text-ink-500">Nothing on the road for you right now.</p>}
          </section>
          <section className="flex flex-col gap-3" aria-label="Delivered">
            <h2 className="text-sm font-semibold text-ink-950">Delivered, last 60 days</h2>
            {done.length ? (
              <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-white">
                {done.map((l) => (
                  <li key={l.ref} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink-950">
                        {l.ref} · {l.origin} → {l.destination}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {l.deliveredAt ? `Delivered ${day(l.deliveredAt)}` : "Delivered"} · {l.podReceived ? "signed POD received" : "POD on its way"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">No deliveries in the last 60 days.</p>
            )}
          </section>
          {invoices.length > 0 && (
            <section className="flex flex-col gap-3" aria-label="Invoices">
              <h2 className="text-sm font-semibold text-ink-950">Invoices</h2>
              <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-white">
                {invoices.map((l) => (
                  <li key={l.invoice!.number} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>
                      <span className="block font-medium text-ink-950">{l.invoice!.number}</span>
                      <span className="block text-xs text-ink-500">
                        Load {l.ref} · sent {day(l.invoice!.sentAt)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold tabular text-ink-950">{formatCurrency(l.invoice!.amount, { decimals: 2 })}</span>
                      <span className="block text-xs text-ink-500">{l.invoice!.paidAt ? `Paid ${day(l.invoice!.paidAt)}` : "Open"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-ink-400">Truck locations show to the nearest town. Questions about a load or an invoice: reply to the carrier&apos;s email.</p>
        </>
      ) : state === "loading" && !demoId ? (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        <p className="text-sm text-ink-600">This link has expired. Ask the carrier for a new one.</p>
      )}
    </main>
  );
}
