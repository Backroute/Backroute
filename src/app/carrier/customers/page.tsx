"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, CalendarPlus, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { PRIMARY_CARRIER_ID } from "@/lib/mock-data";
import { makeContractLoads, markInvoicePaid, removeLane, saveLane, saveShipper } from "@/lib/back-office";
import { dueBy, scheduleWords, WEEKDAYS } from "@/lib/contracts";
import { estimateMiles } from "@/lib/fleet";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { Broker, EquipmentType } from "@/lib/types";
import { Lane } from "@/components/ui/lane";

const input = "h-9 rounded-full border border-line bg-white px-3 text-sm outline-none focus:border-ink-400";

export default function CustomersPage() {
  const shippers = useStore((s) => s.brokers).filter((b) => b.direct && b.carrierId === PRIMARY_CARRIER_ID);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ company: "", contact: "", email: "", phone: "", terms: "30" });
  const [made, setMade] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Shippers you haul for directly: their lanes on a schedule, and their invoices on their terms."
        right={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add a customer
          </Button>
        }
      />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        {adding && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>New customer</CardTitle>
                <CardDescription>Backroute invoices them at this email when a load delivers, with the POD, and follows up on their terms.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="!pt-3">
              <form
                className="grid gap-2 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!form.company.trim()) return;
                  saveShipper({ company: form.company.trim(), contact: form.contact.trim(), email: form.email.trim(), phone: form.phone.trim(), terms: Number(form.terms) || 30 });
                  setForm({ company: "", contact: "", email: "", phone: "", terms: "30" });
                  setAdding(false);
                }}
              >
                <input aria-label="Company" className={input} placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                <input aria-label="Contact" className={input} placeholder="Who you deal with" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
                <input aria-label="Billing email" type="email" className={input} placeholder="Billing email (invoices go here)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <input aria-label="Phone" className={input} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  Pays in
                  <select aria-label="Payment terms" className={input} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })}>
                    {[7, 15, 21, 30, 45, 60].map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2 sm:justify-end">
                  <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" type="submit" disabled={!form.company.trim()}>
                    Save customer
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {shippers.length > 0 && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarPlus className="h-4 w-4" /> Next week&apos;s contract loads
                </CardTitle>
                <CardDescription>Backroute makes each scheduled pickup a load a week ahead, on a truck with the right trailer. Do it now to see them.</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const r = makeContractLoads();
                  setMade(
                    `${r.made.length ? `Made ${r.made.length} load${r.made.length === 1 ? "" : "s"}.` : "Every pickup in the next week already has a load."}${r.noTruck.length ? ` No truck free for: ${r.noTruck.join("; ")}.` : ""}`,
                  );
                }}
              >
                Make them now
              </Button>
            </CardHeader>
            {made && (
              <CardContent className="!pt-0">
                <p role="status" className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-700">
                  {made}
                </p>
              </CardContent>
            )}
          </Card>
        )}

        {shippers.map((s) => (
          <ShipperCard key={s.id} shipper={s} />
        ))}
        {!shippers.length && !adding && (
          <Card>
            <CardContent className="flex flex-col items-start gap-3">
              <p className="text-sm text-ink-600">No direct customers yet. Add the shippers you haul for without a broker, and their regular lanes.</p>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" /> Add a customer
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ShipperCard({ shipper }: { shipper: Broker }) {
  const loads = useStore((s) => s.loads).filter((l) => l.brokerId === shipper.id);
  const open = loads.filter((l) => l.invoice?.sentAt && !l.invoice.paidAt);
  const [lane, setLane] = useState<{ origin: string; destination: string; rate: string; equipment: EquipmentType; days: number[]; time: string } | null>(null);

  const parse = (v: string) => {
    const m = v.split(",").map((x) => x.trim());
    return { city: m[0] ?? "", state: (m[1] ?? "").toUpperCase().slice(0, 2) };
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> {shipper.company}
          </CardTitle>
          <CardDescription>
            {[shipper.contact, shipper.email, shipper.phone].filter(Boolean).join(" · ") || "No contact yet"} · pays in {shipper.terms ?? 30} days · {loads.length} load{loads.length === 1 ? "" : "s"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 !pt-3">
        <div>
          <p className="t-label text-ink-500">Contract lanes</p>
          <ul className="mt-2 flex flex-col gap-2">
            {(shipper.lanes ?? []).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-950">
                    <Lane from={`${l.origin}, ${l.originState}`} to={`${l.destination}, ${l.destState}`} />
                  </p>
                  <p className="text-xs text-ink-500">
                    {scheduleWords(l)} · {l.equipmentType} · {formatCurrency(l.rate)} ({l.miles ? `$${(l.rate / l.miles).toFixed(2)}/mi` : "—"})
                    {l.madeThrough ? ` · loads made through ${formatDate(l.madeThrough)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={l.active} label={`${l.origin} to ${l.destination} on`} onChange={(on) => saveLane(shipper.id, { ...l, active: on })} />
                  <button type="button" aria-label={`Remove the ${l.origin} to ${l.destination} lane`} className="rounded-full p-1.5 text-ink-400 hover:text-ink-950" onClick={() => removeLane(shipper.id, l.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
            {!(shipper.lanes ?? []).length && <li className="text-sm text-ink-500">No scheduled lanes.</li>}
          </ul>
          {lane ? (
            <form
              className="mt-3 flex flex-col gap-2 rounded-2xl bg-ink-50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const a = parse(lane.origin);
                const b = parse(lane.destination);
                if (!a.city || !a.state || !b.city || !b.state || !(Number(lane.rate) > 0) || !lane.days.length) return;
                saveLane(shipper.id, {
                  origin: a.city,
                  originState: a.state,
                  destination: b.city,
                  destState: b.state,
                  miles: estimateMiles(a, b) ?? 0,
                  rate: Number(lane.rate),
                  equipmentType: lane.equipment,
                  days: lane.days,
                  pickupTime: lane.time,
                  active: true,
                });
                setLane(null);
              }}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <input aria-label="Pickup city, state" className={input} placeholder="Pickup: Dallas, TX" value={lane.origin} onChange={(e) => setLane({ ...lane, origin: e.target.value })} />
                <input aria-label="Delivery city, state" className={input} placeholder="Delivery: Houston, TX" value={lane.destination} onChange={(e) => setLane({ ...lane, destination: e.target.value })} />
                <input aria-label="Rate" inputMode="decimal" className={input} placeholder="Rate, all in ($)" value={lane.rate} onChange={(e) => setLane({ ...lane, rate: e.target.value.replace(/[^0-9.]/g, "") })} />
                <div className="flex gap-2">
                  <select aria-label="Trailer" className={cn(input, "flex-1")} value={lane.equipment} onChange={(e) => setLane({ ...lane, equipment: e.target.value as EquipmentType })}>
                    {(["Dry Van", "Reefer", "Flatbed"] as EquipmentType[]).map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                  <input aria-label="Pickup time" type="time" className={input} value={lane.time} onChange={(e) => setLane({ ...lane, time: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pickup days">
                {WEEKDAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={lane.days.includes(i)}
                    onClick={() => setLane({ ...lane, days: lane.days.includes(i) ? lane.days.filter((x) => x !== i) : [...lane.days, i] })}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium", lane.days.includes(i) ? "border-brand bg-brand text-brand-ink" : "border-line text-ink-700")}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" type="submit">
                  Save lane
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setLane(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setLane({ origin: "", destination: "", rate: "", equipment: "Dry Van", days: [1], time: "08:00" })}>
              <Plus className="h-3.5 w-3.5" /> Add a lane
            </Button>
          )}
        </div>

        <div>
          <p className="t-label text-ink-500">Open invoices</p>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {open.map((l) => {
              const due = dueBy(l.invoice!.sentAt!, shipper.terms ?? 30);
              const late = due < new Date().toISOString().slice(0, 10);
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <Link href={`/carrier/loads/${l.id}`} className="min-w-0 text-sm">
                    <span className="font-medium text-ink-950">{l.referenceNumber}</span> <span className="text-ink-500">{formatCurrency(l.invoice!.amount)} · due {formatDate(due)}</span>
                  </Link>
                  <span className="flex items-center gap-2">
                    {late && <Badge tone="danger">Late</Badge>}
                    <Button size="sm" variant="outline" onClick={() => void markInvoicePaid(l.id, l.invoice!.amount)}>
                      Paid
                    </Button>
                  </span>
                </li>
              );
            })}
            {!open.length && <li className="py-2 text-sm text-ink-500">Nothing owed right now.</li>}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
