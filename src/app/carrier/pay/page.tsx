"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, HandCoins, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { PRIMARY_CARRIER_ID } from "@/lib/mock-data";
import { addAdvance, draftPayRuns, markPayRunPaid, updateDriver } from "@/lib/back-office";
import { NEC_THRESHOLD, form1099Csv, form1099s, payRunsCsv, weekEnd, weekOf } from "@/lib/pay-runs";
import { payLabel } from "@/lib/settlements";
import { celebrate } from "@/lib/feedback";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { Driver, PayRun } from "@/lib/types";

const DAY = 86400_000;
const input = "h-9 rounded-full border border-line bg-white px-3 text-sm outline-none focus:border-ink-400";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PayPage() {
  const demo = useStore((s) => s.session.mode === "demo");
  const drivers = useStore((s) => s.drivers).filter((d) => !demo || d.carrierId === PRIMARY_CARRIER_ID);
  const runs = useStore((s) => s.payRuns);
  const advances = useStore((s) => s.advances);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState(() => weekOf(today));
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [open, setOpen] = useState<string | null>(null);
  const [adv, setAdv] = useState({ driverId: "", amount: "", note: "" });
  const [note, setNote] = useState<string | null>(null);

  const week = runs.filter((r) => r.period === period);
  const name = (id: string) => drivers.find((d) => d.id === id)?.name ?? "Driver";
  const shift = (days: number) => setPeriod(weekOf(new Date(Date.parse(`${period}T12:00:00Z`) + days * DAY).toISOString()));
  const forms = form1099s(runs, drivers, year);
  const openAdvances = advances.filter((a) => !a.repaidIn && drivers.some((d) => d.id === a.driverId));

  return (
    <div>
      <PageHeader title="Driver pay" description="Each week's pay, worked out from the loads. Check it, pay it, mark it paid." />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" aria-label="Week before" onClick={() => shift(-7)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div>
                <CardTitle>
                  Week of {formatDate(period)} – {formatDate(weekEnd(period))}
                </CardTitle>
                <CardDescription>{week.length ? `${week.filter((r) => r.status === "paid").length} of ${week.length} paid · ${formatCurrency(week.reduce((s, r) => s + r.net, 0))} net` : "No pay worked out for this week yet."}</CardDescription>
              </div>
              <Button size="sm" variant="ghost" aria-label="Week after" disabled={period >= weekOf(today)} onClick={() => shift(7)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const n = draftPayRuns(period);
                  setNote(n ? `Worked out ${n} driver${n === 1 ? "" : "s"}' pay. Paid ones were left as they are.` : "Nobody delivered a load that week.");
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Work out this week
              </Button>
              <Button size="sm" variant="outline" disabled={!week.length} onClick={() => download(`pay-${period}.csv`, payRunsCsv(week, drivers))}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 !pt-3">
            {note && (
              <p role="status" className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-700">
                {note}
              </p>
            )}
            {week.map((r) => (
              <RunRow key={r.id} run={r} name={name(r.driverId)} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HandCoins className="h-4 w-4" /> Advances
                </CardTitle>
                <CardDescription>Money a driver got ahead of payday. It comes out of their next pay run by itself.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 !pt-3">
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const amount = Number(adv.amount);
                  if (!adv.driverId || !(amount > 0)) return;
                  addAdvance(adv.driverId, amount, adv.note);
                  setAdv({ driverId: "", amount: "", note: "" });
                }}
              >
                <select aria-label="Driver for the advance" className={input} value={adv.driverId} onChange={(e) => setAdv({ ...adv, driverId: e.target.value })}>
                  <option value="">Driver</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <input aria-label="Advance amount" inputMode="decimal" className={cn(input, "w-28")} placeholder="$ amount" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value.replace(/[^0-9.]/g, "") })} />
                <input aria-label="What it's for" className={cn(input, "min-w-0 flex-1")} placeholder="What for (optional)" value={adv.note} onChange={(e) => setAdv({ ...adv, note: e.target.value })} />
                <Button size="sm" type="submit" disabled={!adv.driverId || !(Number(adv.amount) > 0)}>
                  Give advance
                </Button>
              </form>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {openAdvances.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-ink-800">
                      {name(a.driverId)} · {formatDate(a.at)}
                      {a.note ? ` · ${a.note}` : ""}
                    </span>
                    <span className="shrink-0 font-semibold tabular text-ink-950">{formatCurrency(a.amount)}</span>
                  </li>
                ))}
                {!openAdvances.length && <li className="py-2 text-ink-500">None waiting to be paid back.</li>}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>1099s for {year}</CardTitle>
                <CardDescription>
                  What each contractor driver was paid in pay runs marked paid that year. 1099-NEC box 1; reimbursements aren&apos;t income. Filing is needed from{" "}
                  {formatCurrency(NEC_THRESHOLD(year))} up. Check it with your accountant before you file.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <select aria-label="Tax year" className={input} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {[0, 1, 2].map((n) => {
                    const y = new Date().getUTCFullYear() - n;
                    return (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    );
                  })}
                </select>
                <Button size="sm" variant="outline" disabled={!forms.length} onClick={() => download(`1099-nec-${year}.csv`, form1099Csv(forms))}>
                  <Download className="h-3.5 w-3.5" /> 1099s
                </Button>
              </div>
            </CardHeader>
            <CardContent className="!pt-3">
              <ul className="flex flex-col divide-y divide-line text-sm">
                {forms.map((f) => (
                  <li key={f.driverId} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-ink-800">
                      {f.name} · {f.runs} run{f.runs === 1 ? "" : "s"}
                    </span>
                    <span className="flex items-center gap-2">
                      {!f.mustFile && <Badge tone="neutral">Under the threshold</Badge>}
                      <span className="font-semibold tabular text-ink-950">{formatCurrency(f.compensation)}</span>
                    </span>
                  </li>
                ))}
                {!forms.length && <li className="py-2 text-ink-500">No paid runs for contractors in {year}.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>How each driver is paid</CardTitle>
              <CardDescription>Deductions come out of every run with pay in it. Escrow is held back each run up to the cap, and paid back when they leave.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 !pt-3">
            {drivers.map((d) => (
              <DriverPaySetup key={d.id} driver={d} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RunRow({ run, name, open, onToggle }: { run: PayRun; name: string; open: boolean; onToggle: () => void }) {
  const paid = run.status === "paid";
  return (
    <div className="rounded-2xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 text-left">
          <p className="text-sm font-semibold text-ink-950">{name}</p>
          <p className="text-xs text-ink-500">
            {run.lines.length} load{run.lines.length === 1 ? "" : "s"} · gross {formatCurrency(run.gross)}
            {run.deductions.length ? ` · −${formatCurrency(run.deductions.reduce((s, d) => s + d.amount, 0))} deductions` : ""}
            {run.advances.length ? ` · −${formatCurrency(run.advances.reduce((s, a) => s + a.amount, 0))} advance` : ""}
            {run.escrow ? ` · −${formatCurrency(run.escrow)} escrow` : ""}
          </p>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tabular text-ink-950">{formatCurrency(run.net)}</span>
          {paid ? (
            <Badge tone="success">Paid {run.paidAt ? formatDate(run.paidAt) : ""}</Badge>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                markPayRunPaid(run.id);
                celebrate("paid");
              }}
            >
              Mark paid
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-line px-4 py-3 text-sm">
          <ul className="flex flex-col gap-1">
            {run.lines.map((l) => (
              <li key={l.loadId} className="flex justify-between gap-3">
                <span className="truncate text-ink-700">
                  {l.ref} · {l.lane}
                </span>
                <span className="tabular text-ink-950">{formatCurrency(l.pay)}</span>
              </li>
            ))}
            {run.extras.map((x, i) => (
              <li key={`x${i}`} className="flex justify-between gap-3">
                <span className="text-ink-700">{x.label}</span>
                <span className="tabular text-ink-950">+{formatCurrency(x.amount)}</span>
              </li>
            ))}
            {run.deductions.map((x, i) => (
              <li key={`d${i}`} className="flex justify-between gap-3">
                <span className="text-ink-700">{x.label}</span>
                <span className="tabular text-ink-950">−{formatCurrency(x.amount)}</span>
              </li>
            ))}
            {run.advances.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span className="text-ink-700">Advance paid back</span>
                <span className="tabular text-ink-950">−{formatCurrency(a.amount)}</span>
              </li>
            ))}
            {run.escrow > 0 && (
              <li className="flex justify-between gap-3">
                <span className="text-ink-700">Escrow held</span>
                <span className="tabular text-ink-950">−{formatCurrency(run.escrow)}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function DriverPaySetup({ driver }: { driver: Driver }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const deductions = driver.deductions ?? [];
  return (
    <details className="rounded-2xl border border-line px-4 py-3">
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
        <span className="font-medium text-ink-950">{driver.name}</span>
        <span className="text-xs text-ink-500">
          {payLabel(driver)} · {(driver.taxForm ?? "1099") === "1099" ? "1099 contractor" : "W-2 employee"}
          {deductions.length ? ` · ${deductions.length} deduction${deductions.length === 1 ? "" : "s"}` : ""}
          {driver.escrow ? ` · escrow ${formatCurrency(driver.escrow.held)} of ${formatCurrency(driver.escrow.cap)}` : ""}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span className="text-ink-700">Paid as</span>
          <select aria-label={`${driver.name} tax form`} className={input} value={driver.taxForm ?? "1099"} onChange={(e) => updateDriver(driver.id, { taxForm: e.target.value as "1099" | "w2" })}>
            <option value="1099">Contractor (1099)</option>
            <option value="w2">Employee (W-2, through payroll)</option>
          </select>
        </label>
        <div>
          <p className="text-ink-700">Deductions each run</p>
          <ul className="mt-1 flex flex-col gap-1">
            {deductions.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <span className="text-ink-800">
                  {d.label}
                  {d.every === "once" ? " (once)" : ""}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular text-ink-950">{formatCurrency(d.amount)}</span>
                  <button type="button" aria-label={`Remove ${d.label}`} className="text-ink-400 hover:text-ink-950" onClick={() => updateDriver(driver.id, { deductions: deductions.filter((x) => x.id !== d.id) })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(amount);
              if (!label.trim() || !(n > 0)) return;
              updateDriver(driver.id, { deductions: [...deductions, { id: `ded_${Date.now().toString(36)}`, label: label.trim().slice(0, 60), amount: n, every: "run" }] });
              setLabel("");
              setAmount("");
            }}
          >
            <input aria-label="Deduction" className={cn(input, "min-w-0 flex-1")} placeholder="Insurance, ELD, truck lease…" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input aria-label="Deduction amount" inputMode="decimal" className={cn(input, "w-24")} placeholder="$" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
            <Button size="sm" variant="outline" type="submit">
              Add
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-700">Escrow</span>
          <input
            aria-label={`${driver.name} escrow per run`}
            inputMode="decimal"
            className={cn(input, "w-24")}
            placeholder="$ per run"
            defaultValue={driver.escrow?.perRun ?? ""}
            onBlur={(e) => {
              const perRun = Number(e.target.value) || 0;
              updateDriver(driver.id, { escrow: perRun ? { perRun, cap: driver.escrow?.cap ?? 2500, held: driver.escrow?.held ?? 0 } : undefined });
            }}
          />
          <span className="text-ink-500">up to</span>
          <input
            aria-label={`${driver.name} escrow cap`}
            inputMode="decimal"
            className={cn(input, "w-28")}
            placeholder="$ cap"
            defaultValue={driver.escrow?.cap ?? ""}
            onBlur={(e) => driver.escrow && updateDriver(driver.id, { escrow: { ...driver.escrow, cap: Number(e.target.value) || driver.escrow.cap } })}
          />
        </div>
      </div>
    </details>
  );
}
