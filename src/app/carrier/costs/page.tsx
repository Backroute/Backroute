"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Fuel, Receipt, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { useCarrierLoads, useCarrierTrucks } from "@/lib/selectors";
import { assignUnit, importStatement, type ImportSummary } from "@/lib/back-office";
import { costsByLoad, gallonsByState } from "@/lib/fuel-import";
import { iftaReturnDue } from "@/lib/expiry";
import { formatCurrency, formatDate } from "@/lib/utils";

/** The quarter a date is in, as yyyy-mm-dd bounds. */
function quarterOf(now: number): { from: string; to: string; label: string } {
  const d = new Date(now);
  const q = Math.floor(d.getUTCMonth() / 3);
  const y = d.getUTCFullYear();
  const from = new Date(Date.UTC(y, q * 3, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10);
  return { from, to, label: `Q${q + 1} ${y}` };
}

export default function CostsPage() {
  const fuel = useStore((s) => s.fuelTx);
  const tolls = useStore((s) => s.tollTx);
  const loads = useCarrierLoads();
  const trucks = useCarrierTrucks();
  const [result, setResult] = useState<{ kind: "fuel" | "toll"; r: ImportSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fuelFile = useRef<HTMLInputElement>(null);
  const tollFile = useRef<HTMLInputElement>(null);
  const [now] = useState(() => Date.now());

  async function read(kind: "fuel" | "toll", file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const r = importStatement(kind, await file.text());
      if (!r.added && !r.duplicates) setError("Nothing in that file looked like a statement line (a date and an amount). Is it the transactions export?");
      setResult({ kind, r });
    } catch {
      setError("Couldn't read that file. Save it as CSV from the card's website and try again.");
    }
  }

  const month = new Date(now).toISOString().slice(0, 7);
  const fuelMonth = fuel.filter((f) => f.date.startsWith(month));
  const tollMonth = tolls.filter((t) => t.date.startsWith(month));
  const diesel = fuelMonth.filter((f) => f.product === "diesel");
  const gallons = diesel.reduce((s, f) => s + f.gallons, 0);
  const dieselSpend = diesel.reduce((s, f) => s + f.amount, 0);
  const unmatched = [...fuel, ...tolls].filter((x) => !x.loadId);
  const unknownUnits = [...new Set([...fuel, ...tolls].filter((x) => !x.truckId && x.unit).map((x) => x.unit))];
  const perLoad = costsByLoad(fuel, tolls);
  const costed = loads.filter((l) => perLoad.has(l.id)).slice(0, 12);
  const q = quarterOf(now);
  const byState = gallonsByState(fuel, q.from, q.to);
  const ifta = iftaReturnDue(now);

  return (
    <div>
      <PageHeader title="Fuel & tolls" description="Fuel card and toll statements, put on the loads they paid for." />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-4 w-4" /> Bring in a statement
              </CardTitle>
              <CardDescription>
                Download the transactions as CSV from the fuel card (WEX, Comdata, EFS, TCS, AtoB) or toll account (PrePass, BestPass, E-ZPass) and drop it here.
                Each line goes on the load that truck was running that day. Importing the same file twice doesn&apos;t count anything twice.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 !pt-3">
            <div className="flex flex-wrap gap-2">
              <input ref={fuelFile} type="file" accept=".csv,text/csv,.txt" className="hidden" aria-label="Fuel card statement" onChange={(e) => void read("fuel", e.target.files?.[0]).finally(() => (e.target.value = ""))} />
              <input ref={tollFile} type="file" accept=".csv,text/csv,.txt" className="hidden" aria-label="Toll statement" onChange={(e) => void read("toll", e.target.files?.[0]).finally(() => (e.target.value = ""))} />
              <Button size="sm" onClick={() => fuelFile.current?.click()}>
                <Fuel className="h-3.5 w-3.5" /> Fuel card CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => tollFile.current?.click()}>
                <Receipt className="h-3.5 w-3.5" /> Toll CSV
              </Button>
            </div>
            {result && (
              <p role="status" className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-700">
                {result.r.added} new {result.kind === "fuel" ? "fuel purchases" : "tolls"}, {result.r.matched} on a load
                {result.r.duplicates ? `, ${result.r.duplicates} already here` : ""}
                {result.r.skipped ? `, ${result.r.skipped} lines without a date or amount skipped` : ""}.
              </p>
            )}
            {error && <p className="text-sm text-[var(--accent-danger)]">{error}</p>}
            <p className="text-xs text-ink-500">With the card company&apos;s feed connected (Settings → Connections), they come in by themselves every night.</p>
          </CardContent>
        </Card>

        {unknownUnits.length > 0 && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Which truck is this?</CardTitle>
                <CardDescription>The statement names these cards or units; pick the truck once and every line with it goes to its loads.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 !pt-3">
              {unknownUnits.slice(0, 8).map((u) => (
                <label key={u} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-ink-900">{u}</span>
                  <select aria-label={`Truck for ${u}`} defaultValue="" onChange={(e) => e.target.value && assignUnit(u, e.target.value)} className="h-9 rounded-full border border-line bg-white px-3 text-sm">
                    <option value="">Pick a truck</option>
                    {trucks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.unitNumber}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Diesel this month" value={formatCurrency(dieselSpend)} sub={`${Math.round(gallons).toLocaleString()} gal`} />
          <Tile label="Average per gallon" value={gallons ? `$${(dieselSpend / gallons).toFixed(3)}` : "—"} />
          <Tile label="Tolls this month" value={formatCurrency(tollMonth.reduce((s, t) => s + t.amount, 0))} sub={`${tollMonth.length} tolls`} />
          <Tile label="Not on a load yet" value={String(unmatched.length)} sub={unmatched.length ? "No truck, or no load that day" : "Everything matched"} />
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>What each load really cost</CardTitle>
              <CardDescription>Fuel and tolls from the statements, against the estimate the AI booked it on.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            {costed.length === 0 ? (
              <p className="text-sm text-ink-500">Bring in a statement and the loads it paid for show up here.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {costed.map((l) => {
                  const c = perLoad.get(l.id)!;
                  const real = c.fuel + c.tolls;
                  const est = l.fuelCost + l.tollCost;
                  const net = (l.bookedRate ?? l.targetRate) - real - l.commission - l.deadheadCost;
                  return (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <Link href={`/carrier/loads/${l.id}`} className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-950">
                          {l.lane.origin} → {l.lane.destination}
                        </p>
                        <p className="text-xs text-ink-500">
                          {l.referenceNumber} · fuel {formatCurrency(c.fuel)} ({Math.round(c.gallons)} gal) · tolls {formatCurrency(c.tolls)}
                        </p>
                      </Link>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular text-ink-950">{formatCurrency(net)} net</p>
                        <p className={`text-xs tabular ${real > est * 1.1 ? "text-[var(--accent-danger)]" : "text-ink-500"}`}>
                          {real > est ? `${formatCurrency(real - est)} over` : `${formatCurrency(est - real)} under`} the estimate
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Diesel by state, {q.label}</CardTitle>
              <CardDescription>
                The fuel half of the IFTA return ({ifta.quarter} is due {formatDate(ifta.due)}). Miles by state are on Compliance.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            {byState.length === 0 ? (
              <p className="text-sm text-ink-500">No diesel purchases this quarter yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {byState.map((s) => (
                  <span key={s.state} className="rounded-xl border border-line px-3 py-2 text-sm">
                    <span className="font-semibold text-ink-950">{s.state}</span> <span className="tabular text-ink-600">{s.gallons.toLocaleString()} gal</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Latest lines</CardTitle>
              <CardDescription>From the statements, newest first.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="!pt-3">
            <ul className="flex flex-col divide-y divide-line text-sm">
              {[...fuel.map((f) => ({ ...f, kind: "Fuel" as const, where: `${f.merchant} · ${f.city}${f.state ? `, ${f.state}` : ""}`, extra: f.gallons ? `${f.gallons} gal ${f.product === "diesel" ? "" : f.product.toUpperCase()}` : "" })), ...tolls.map((t) => ({ ...t, kind: "Toll" as const, where: `${t.agency}${t.plaza ? ` · ${t.plaza}` : ""}`, extra: "" }))]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 25)
                .map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-ink-900">
                        <Badge tone="neutral" className="mr-1.5">
                          {x.kind}
                        </Badge>
                        {x.where}
                      </p>
                      <p className="text-xs text-ink-500">
                        {formatDate(x.date)} · {trucks.find((t) => t.id === x.truckId)?.unitNumber ?? x.unit ?? "No truck"}
                        {x.extra ? ` · ${x.extra}` : ""} · {x.loadId ? (loads.find((l) => l.id === x.loadId)?.referenceNumber ?? "on a load") : "no load"}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular text-ink-950">{formatCurrency(x.amount)}</span>
                  </li>
                ))}
            </ul>
            {fuel.length + tolls.length === 0 && <p className="text-sm text-ink-500">Nothing yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <section className="flex min-h-[6.5rem] flex-col justify-between rounded-3xl border border-line bg-white p-4">
      <p className="t-label text-ink-500">{label}</p>
      <div className="mt-2">
        <p className="text-2xl font-semibold tabular tracking-tight text-ink-950">{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-ink-500">{sub}</p>}
      </div>
    </section>
  );
}
