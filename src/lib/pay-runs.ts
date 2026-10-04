import { computeDriverPay } from "./settlements";
import type { Advance, Driver, Expense, Load, PayRun, Truck } from "./types";

/**
 * Driver pay, week by week, the way a bookkeeper runs it: the loads each driver delivered that week at their pay
 * rate, plus what the carrier owes them back (approved lumpers, scales, parking), minus their deductions (insurance,
 * ELD, a truck lease), any advance they took, and escrow held back up to its cap. Paid runs are what the 1099 adds up
 * at year end.
 */

const DAY = 86400_000;

/** Monday of the week a date falls in, yyyy-mm-dd (UTC). */
export function weekOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}

export const weekEnd = (monday: string) => new Date(Date.parse(`${monday}T12:00:00Z`) + 6 * DAY).toISOString().slice(0, 10);

/** When a load counts as delivered, for pay. */
export const deliveredOn = (l: Load) => (l.tripChecklist?.unloadedAt ?? l.deliveryAt ?? l.updatedAt).slice(0, 10);

const round = (n: number) => Math.round(n * 100) / 100;

/** The driver's loads delivered in the week, on any truck they drove (team trucks split the pay). */
function loadsFor(driver: Driver, loads: Load[], trucks: Truck[], period: string) {
  const end = weekEnd(period);
  return loads
    .filter((l) => l.stage === "delivered" && l.truckId)
    .map((l) => ({ l, truck: trucks.find((t) => t.id === l.truckId) }))
    .filter(({ l, truck }) => truck && (truck.driverId === driver.id || truck.secondDriverId === driver.id) && deliveredOn(l) >= period && deliveredOn(l) <= end);
}

export function buildPayRun(input: {
  driver: Driver;
  period: string;
  loads: Load[];
  trucks: Truck[];
  expenses: Expense[];
  advances: Advance[];
  /** Runs already made, so a load or an advance is never paid or taken twice. */
  runs: PayRun[];
  now?: string;
}): PayRun {
  const { driver, period } = input;
  const end = weekEnd(period);
  const others = input.runs.filter((r) => !(r.driverId === driver.id && r.period === period));
  const paidLoads = new Set(others.flatMap((r) => r.lines.map((x) => x.loadId)));
  const lines = loadsFor(driver, input.loads, input.trucks, period)
    .filter(({ l }) => !paidLoads.has(l.id))
    .map(({ l, truck }) => ({
      loadId: l.id,
      ref: l.referenceNumber,
      lane: `${l.lane.origin}, ${l.lane.originState} → ${l.lane.destination}, ${l.lane.destState}`,
      pay: computeDriverPay(l, driver, !!truck?.secondDriverId),
    }));
  const extras = input.expenses
    // Paid by the company up front (a lumper code, a reserved parking spot): nothing came out of the driver's pocket.
    .filter((e) => e.driverId === driver.id && e.status === "approved" && !e.upfront && (e.respondedAt ?? e.createdAt).slice(0, 10) <= end && (e.respondedAt ?? e.createdAt).slice(0, 10) >= period)
    .map((e) => ({ label: `${e.category[0].toUpperCase()}${e.category.slice(1)} reimbursed${e.note ? `: ${e.note}` : ""}`, amount: e.amount }));
  const gross = round(lines.reduce((s, x) => s + x.pay, 0) + extras.reduce((s, x) => s + x.amount, 0));

  // Deductions that repeat come out of every run with pay in it; one-time ones out of the first.
  const usedOnce = new Set(others.filter((r) => r.driverId === driver.id).flatMap((r) => r.deductions.map((d) => d.label)));
  const deductions = gross > 0 ? (driver.deductions ?? []).filter((d) => d.every === "run" || !usedOnce.has(d.label)).map((d) => ({ label: d.label, amount: d.amount })) : [];
  // Advances come back out of what's left after deductions, as much as fits; the rest waits for the next run, so a
  // check is never negative.
  const takenBefore = (id: string) => others.flatMap((r) => r.advances).filter((a) => a.id === id).reduce((n, a) => n + a.amount, 0);
  let room = Math.max(0, gross - deductions.reduce((n, d) => n + d.amount, 0));
  const advances: PayRun["advances"] = [];
  for (const a of input.advances.filter((x) => x.driverId === driver.id && x.at.slice(0, 10) <= end).sort((x, y) => x.at.localeCompare(y.at))) {
    const left = round(a.amount - takenBefore(a.id));
    const take = round(Math.min(left, room));
    if (take <= 0) continue;
    advances.push({ id: a.id, amount: take });
    room = round(room - take);
  }
  const owed = gross - deductions.reduce((s, d) => s + d.amount, 0) - advances.reduce((s, a) => s + a.amount, 0);
  const held = (driver.escrow?.held ?? 0) + others.filter((r) => r.driverId === driver.id && r.status === "draft").reduce((s, r) => s + r.escrow, 0);
  const escrow = driver.escrow && owed > 0 ? round(Math.max(0, Math.min(driver.escrow.perRun, driver.escrow.cap - held, owed))) : 0;
  return {
    id: `${driver.id}:${period}`,
    carrierId: driver.carrierId,
    driverId: driver.id,
    period,
    periodEnd: end,
    lines,
    extras,
    gross,
    deductions,
    advances,
    escrow,
    net: round(owed - escrow),
    status: "draft",
    createdAt: input.now ?? new Date().toISOString(),
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The week's pay for the bank, payroll or the accountant: one line per driver. */
export function payRunsCsv(runs: PayRun[], drivers: Driver[]): string {
  const head = ["Driver", "Week of", "Loads", "Gross", "Deductions", "Advances", "Escrow", "Net pay", "Status", "Paid on"];
  const rows = runs.map((r) => [
    drivers.find((d) => d.id === r.driverId)?.name ?? r.driverId,
    r.period,
    r.lines.length,
    r.gross.toFixed(2),
    r.deductions.reduce((s, d) => s + d.amount, 0).toFixed(2),
    r.advances.reduce((s, a) => s + a.amount, 0).toFixed(2),
    r.escrow.toFixed(2),
    r.net.toFixed(2),
    r.status,
    r.paidAt?.slice(0, 10) ?? "",
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export interface Form1099 {
  driverId: string;
  name: string;
  year: number;
  /** Box 1, nonemployee compensation: everything paid for their work in the year, before deductions they owed. */
  compensation: number;
  /** Reimbursements aren't income: they're left out. */
  reimbursed: number;
  runs: number;
  /** Over the IRS threshold for filing a 1099-NEC ($600 for payments in 2025, $2,000 from 2026). */
  mustFile: boolean;
}

export const NEC_THRESHOLD = (year: number) => (year >= 2026 ? 2000 : 600);

/** Year-end: what each contractor driver was paid, from the runs marked paid in that year. */
export function form1099s(runs: PayRun[], drivers: Driver[], year: number): Form1099[] {
  return drivers
    .filter((d) => (d.taxForm ?? "1099") === "1099")
    .map((d) => {
      const paid = runs.filter((r) => r.driverId === d.id && r.status === "paid" && (r.paidAt ?? "").startsWith(String(year)));
      const reimbursed = round(paid.reduce((s, r) => s + r.extras.filter((e) => /reimbursed/i.test(e.label)).reduce((a, e) => a + e.amount, 0), 0));
      const compensation = round(paid.reduce((s, r) => s + r.gross, 0) - reimbursed);
      return { driverId: d.id, name: d.name, year, compensation, reimbursed, runs: paid.length, mustFile: compensation >= NEC_THRESHOLD(year) };
    })
    .filter((f) => f.runs > 0);
}

export function form1099Csv(forms: Form1099[]): string {
  const head = ["Recipient", "Tax year", "Box 1 nonemployee compensation", "Reimbursements (not reported)", "Pay runs", "File a 1099-NEC"];
  return [head, ...forms.map((f) => [f.name, f.year, f.compensation.toFixed(2), f.reimbursed.toFixed(2), f.runs, f.mustFile ? "Yes" : "No (under the threshold)"])]
    .map((r) => r.map(csvCell).join(","))
    .join("\n");
}
