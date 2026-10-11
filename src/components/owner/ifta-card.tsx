"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { useCarrierLoads, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { fleetStateMiles, gallonsInQuarter, iftaReturn, parseIftaMatrix, quarterOf, sampleMilesByState } from "@/lib/ifta";
import { downloadCsv } from "@/lib/csv-export";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

/** The filing deadline for a quarter: the last day of the month after it ends. */
const DUE: Record<string, string> = { "1": "April 30", "2": "July 31", "3": "October 31", "4": "January 31" };

function lastQuarters(now: Date): string[] {
  const q = quarterOf(now);
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(-1));
  return [q, n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`];
}

/**
 * IFTA for the quarter: miles by state from the ELD, gallons by state from the fuel card, and the quarter's rates from
 * IFTA, Inc.'s rate matrix the owner uploads. Each piece says where it came from, and a missing one says how to get it.
 */
export function IftaCard() {
  const real = useStore((s) => s.session.mode !== "demo");
  const trucks = useCarrierTrucks();
  const loads = useCarrierLoads();
  const fuel = useStore((s) => s.fuelTx);
  const saved = useStore((s) => s.settings.iftaRates);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const quarters = lastQuarters(new Date());
  const [quarter, setQuarter] = useState(quarters[0]);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const eldMiles = fleetStateMiles(trucks, quarter);
  const fromEld = Object.keys(eldMiles).length > 0;
  // The practice fleet has no ELD: its miles are spread over each lane's two states, and said so.
  const sample = !real && !fromEld;
  const booked = loads.filter((l) => !["sourced", "scoring", "offered", "declined", "cancelled"].includes(l.stage) && quarterOf(l.createdAt) === quarter);
  const miles = fromEld ? eldMiles : sample ? sampleMilesByState(booked) : {};
  const gallons = gallonsInQuarter(fuel, quarter);
  const rates = saved?.quarter === quarter ? saved : undefined;
  const r = iftaReturn(miles, gallons, rates?.rates);
  const eldTrucks = trucks.filter((t) => Object.keys(t.stateMiles?.[quarter] ?? {}).length).length;
  const ready = Object.keys(miles).length > 0 && r.totalGallons > 0 && !!rates && r.missingRates.length === 0;

  async function upload(f: File) {
    setError(null);
    const parsed = parseIftaMatrix(await f.text());
    if ("error" in parsed) return setError(parsed.error);
    updateSettings({ iftaRates: { quarter, rates: parsed.rates, importedAt: new Date().toISOString(), fileName: f.name } });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4" /> IFTA
          </CardTitle>
          <CardDescription>Miles from the ELD, fuel from your fuel card, rates from IFTA&apos;s rate file. Due {DUE[quarter.slice(-1)]}.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            aria-label="Quarter"
            className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-900 outline-none"
          >
            {quarters.map((q) => (
              <option key={q} value={q}>
                {q.replace("-", " ")}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={r.lines.length === 0}
            onClick={() =>
              downloadCsv(
                `ifta-${quarter}.csv`,
                ["Jurisdiction", "Miles", "Taxable gallons", "Gallons bought", "Rate per gallon", "Net tax"],
                r.lines.map((l) => [l.state, l.miles, l.taxableGallons, l.paidGallons, l.rate ?? "", l.net ?? ""]),
              )
            }
          >
            <Download className="h-3.5 w-3.5" /> Worksheet
          </Button>
        </div>
      </CardHeader>
      <CardContent className="!pt-3">
        <ul className="flex flex-col gap-2 text-sm">
          <Source ok={fromEld || sample} warn={sample}>
            {fromEld ? (
              <>Miles by state from the ELD, {eldTrucks} truck{eldTrucks === 1 ? "" : "s"}, counted from each position as it comes in.</>
            ) : sample ? (
              <>Sample miles: the practice fleet has no ELD, so each lane&apos;s miles are split between its two states.</>
            ) : (
              <>
                No ELD miles for this quarter yet. <Link href="/carrier/settings?tab=integrations" className="font-medium underline">Connect your ELD</Link> and they
                add up from the next position on.
              </>
            )}
          </Source>
          <Source ok={r.totalGallons > 0}>
            {r.totalGallons > 0 ? (
              <>{formatNumber(r.totalGallons)} gallons of diesel by state from your fuel card statements.</>
            ) : (
              <>
                No fuel purchases this quarter. <Link href="/carrier/costs" className="font-medium underline">Import your fuel card statement</Link>.
              </>
            )}
          </Source>
          <Source ok={!!rates && r.missingRates.length === 0} warn={!!rates && r.missingRates.length > 0}>
            {rates ? (
              <>
                Rates from {rates.fileName}
                {r.missingRates.length ? `; not in the file: ${r.missingRates.join(", ")}` : ""}.{" "}
              </>
            ) : (
              <>Upload this quarter&apos;s tax rate matrix from iftach.org (the CSV). Backroute doesn&apos;t guess rates. </>
            )}
            <button type="button" onClick={() => file.current?.click()} className="inline-flex items-center gap-1 font-medium underline">
              <Upload className="h-3 w-3" /> {rates ? "Replace" : "Upload rates"}
            </button>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv,.txt"
              className="sr-only"
              aria-label="IFTA rate matrix file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </Source>
        </ul>
        {error && <p className="mt-2 text-xs text-[var(--accent-danger)]">{error}</p>}

        {r.lines.length > 0 && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile label="Miles" value={formatNumber(r.totalMiles)} />
              <StatTile label="Gallons bought" value={formatNumber(r.totalGallons)} />
              <StatTile label="Fleet MPG" value={r.mpg ?? "—"} />
              <StatTile label={r.net >= 0 ? "Tax due" : "Credit"} value={rates && r.mpg ? formatCurrency(Math.abs(r.net)) : "—"} />
            </div>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-xs text-ink-500">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left font-medium">State</th>
                    <th className="px-3 py-2 text-right font-medium">Miles</th>
                    <th className="px-3 py-2 text-right font-medium">Taxable gal</th>
                    <th className="px-3 py-2 text-right font-medium">Bought gal</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                    <th className="px-4 py-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular">
                  {r.lines.map((l) => (
                    <tr key={l.state}>
                      <td className="px-4 py-2 font-medium text-ink-900">{l.state}</td>
                      <td className="px-3 py-2 text-right text-ink-700">{formatNumber(l.miles)}</td>
                      <td className="px-3 py-2 text-right text-ink-700">{r.mpg ? l.taxableGallons : "—"}</td>
                      <td className="px-3 py-2 text-right text-ink-700">{l.paidGallons || "—"}</td>
                      <td className="px-3 py-2 text-right text-ink-500">{l.rate === null ? "—" : `$${l.rate.toFixed(4)}`}</td>
                      <td className={cn("px-4 py-2 text-right font-medium", (l.net ?? 0) < 0 ? "text-[var(--accent-live)]" : "text-ink-950")}>
                        {l.net === null ? "—" : `${l.net < 0 ? "−" : ""}${formatCurrency(Math.abs(l.net))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className={cn("mt-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm", ready ? "bg-live-soft text-[var(--accent-live)]" : "bg-ink-50 text-ink-600")}>
          {ready ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {ready
            ? "Worksheet ready. File it on your base state's IFTA site; surcharges some states add are listed separately in the rate file."
            : "The worksheet fills in as the three pieces above come in."}
        </p>
      </CardContent>
    </Card>
  );
}

function Source({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok && !warn ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-live)]" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-warn)]" />
      )}
      <span className="text-ink-700">{children}</span>
    </li>
  );
}
