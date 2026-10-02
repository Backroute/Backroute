"use client";

import { useStore } from "./store";
import { PRIMARY_CARRIER_ID } from "./mock-data";
import { matchToLoads, onlyNew, readFuelCsv, readTollCsv } from "./fuel-import";
import { buildPayRun } from "./pay-runs";
import { contractLoadsDue } from "./contracts";
import { supabase } from "./cloud/client";
import type { Advance, Broker, ContractLane, Driver, Load, Truck } from "./types";

/**
 * The owner's (and bookkeeper's) back office on screen: importing fuel and toll statements, pay runs and advances,
 * paperwork dates, direct shippers and their contract loads. Each changes the app's data; the sync layer saves it
 * like everything else.
 */

const set = useStore.setState;
const get = useStore.getState;
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export interface ImportSummary {
  added: number;
  matched: number;
  duplicates: number;
  skipped: number;
  unmatchedUnits: string[];
}

/** A fuel card or toll statement (CSV): new lines only, each put on the load its truck was running that day. */
export function importStatement(kind: "fuel" | "toll", text: string): ImportSummary {
  const s = get();
  const carrierId = s.session.carrierId ?? PRIMARY_CARRIER_ID;
  const trucks = s.trucks.filter((t) => t.carrierId === PRIMARY_CARRIER_ID || s.session.mode !== "demo");
  if (kind === "fuel") {
    const read = readFuelCsv(text, carrierId, trucks);
    const fresh = matchToLoads(onlyNew(s.fuelTx, read.rows), s.loads);
    set((st) => ({ fuelTx: [...fresh, ...st.fuelTx] }));
    return summary(read.rows.length, fresh, read.skipped.length);
  }
  const read = readTollCsv(text, carrierId, trucks);
  const fresh = matchToLoads(onlyNew(s.tollTx, read.rows), s.loads);
  set((st) => ({ tollTx: [...fresh, ...st.tollTx] }));
  return summary(read.rows.length, fresh, read.skipped.length);
}

function summary(read: number, fresh: { loadId: string | null; truckId: string | null; unit: string }[], skipped: number): ImportSummary {
  return {
    added: fresh.length,
    matched: fresh.filter((x) => x.loadId).length,
    duplicates: read - fresh.length,
    skipped,
    unmatchedUnits: [...new Set(fresh.filter((x) => !x.truckId && x.unit).map((x) => x.unit))].slice(0, 6),
  };
}

/** Tries again to match what didn't have a load (a load added after the statement came in). */
export function rematchCosts() {
  set((s) => ({ fuelTx: matchToLoads(s.fuelTx, s.loads), tollTx: matchToLoads(s.tollTx, s.loads) }));
}

/** Ties a statement's unit or card number to a truck, then matches its lines again. */
export function assignUnit(unit: string, truckId: string) {
  set((s) => ({
    fuelTx: matchToLoads(s.fuelTx.map((f) => (f.unit === unit && !f.truckId ? { ...f, truckId } : f)), s.loads),
    tollTx: matchToLoads(s.tollTx.map((t) => (t.unit === unit && !t.truckId ? { ...t, truckId } : t)), s.loads),
  }));
}

/** Drafts (or redrafts) the week's pay run for every driver with pay in it. Paid runs are never touched. */
export function draftPayRuns(period: string): number {
  const s = get();
  const drivers = s.drivers.filter((d) => s.session.mode !== "demo" || d.carrierId === PRIMARY_CARRIER_ID);
  let runs = s.payRuns;
  let made = 0;
  for (const driver of drivers) {
    const id = `${driver.id}:${period}`;
    if (runs.some((r) => r.id === id && r.status === "paid")) continue;
    const run = buildPayRun({ driver, period, loads: s.loads, trucks: s.trucks, expenses: s.expenses, advances: s.advances, runs });
    if (run.gross <= 0 && !runs.some((r) => r.id === id)) continue;
    runs = runs.some((r) => r.id === id) ? runs.map((r) => (r.id === id ? run : r)) : [run, ...runs];
    made++;
  }
  set({ payRuns: runs });
  return made;
}

/** Paid: the run is locked, its advances are settled, and its escrow is added to what's held for the driver. */
export function markPayRunPaid(id: string) {
  const run = get().payRuns.find((r) => r.id === id);
  if (!run || run.status === "paid") return;
  const paidAt = new Date().toISOString();
  set((s) => ({
    payRuns: s.payRuns.map((r) => (r.id === id ? { ...r, status: "paid" as const, paidAt } : r)),
    // An advance is settled once paid runs have taken all of it back.
    advances: s.advances.map((a) => {
      const back = [...s.payRuns.filter((r) => r.status === "paid"), run].flatMap((r) => r.advances).filter((x) => x.id === a.id).reduce((n, x) => n + x.amount, 0);
      return back >= a.amount - 0.005 ? { ...a, repaidIn: run.id } : a;
    }),
    drivers: s.drivers.map((d) => (d.id === run.driverId && d.escrow && run.escrow ? { ...d, escrow: { ...d.escrow, held: d.escrow.held + run.escrow } } : d)),
  }));
}

export function addAdvance(driverId: string, amount: number, note: string): Advance {
  const s = get();
  const advance: Advance = { id: uid("adv"), carrierId: s.session.carrierId ?? PRIMARY_CARRIER_ID, driverId, amount: Math.round(amount * 100) / 100, note: note.trim(), at: new Date().toISOString() };
  set((st) => ({ advances: [advance, ...st.advances] }));
  return advance;
}

export function updateDriver(id: string, patch: Partial<Driver>) {
  set((s) => ({ drivers: s.drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
}

export function updateTruck(id: string, patch: Partial<Truck>) {
  set((s) => ({ trucks: s.trucks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

/** Adds a direct shipper, or saves changes to one. */
export function saveShipper(shipper: Partial<Broker> & { company: string }): Broker {
  const s = get();
  const existing = shipper.id ? s.brokers.find((b) => b.id === shipper.id) : undefined;
  const next: Broker = {
    reliability: 90,
    avgResponseMins: 30,
    loadsBooked: 0,
    onTimePct: 100,
    avgRateVariancePct: 0,
    tier: "preferred",
    authorityVerified: true,
    fraudRisk: "low",
    avgDaysToPay: shipper.terms ?? 30,
    detentionPaidPct: 0,
    cancellations90d: 0,
    contact: "",
    phone: "",
    email: "",
    lanes: [],
    ...existing,
    ...shipper,
    id: existing?.id ?? uid("shipper"),
    carrierId: PRIMARY_CARRIER_ID,
    direct: true,
  };
  set((st) => ({ brokers: existing ? st.brokers.map((b) => (b.id === next.id ? next : b)) : [...st.brokers, next] }));
  return next;
}

export function saveLane(shipperId: string, lane: Omit<ContractLane, "id"> & { id?: string }) {
  const shipper = get().brokers.find((b) => b.id === shipperId);
  if (!shipper) return;
  const lanes = shipper.lanes ?? [];
  const full: ContractLane = { ...lane, id: lane.id ?? uid("lane") };
  saveShipper({ ...shipper, lanes: lanes.some((l) => l.id === full.id) ? lanes.map((l) => (l.id === full.id ? full : l)) : [...lanes, full] });
}

export function removeLane(shipperId: string, laneId: string) {
  const shipper = get().brokers.find((b) => b.id === shipperId);
  if (shipper) saveShipper({ ...shipper, lanes: (shipper.lanes ?? []).filter((l) => l.id !== laneId) });
}

/**
 * Makes loads for the contract pickups in the next week, each on a truck with the right trailer (the one free soonest).
 * Returns what was made and the pickups with no truck for them.
 */
export function makeContractLoads(today = new Date().toISOString().slice(0, 10)): { made: Load[]; noTruck: string[] } {
  const s = get();
  const shippers = s.brokers.filter((b) => b.direct && b.carrierId === PRIMARY_CARRIER_ID);
  const made: Load[] = [];
  const noTruck: string[] = [];
  const through = new Map<string, string>();
  for (const plan of contractLoadsDue(shippers, today)) {
    const trucks = get().trucks.filter((t) => t.carrierId === PRIMARY_CARRIER_ID && t.driverId && t.equipmentType === plan.lane.equipmentType && t.status !== "maintenance");
    const truck = trucks.find((t) => !t.currentLoadId) ?? trucks.find((t) => !t.nextLoadId);
    const label = `${plan.lane.origin} → ${plan.lane.destination} on ${plan.date}`;
    if (!truck) {
      noTruck.push(label);
      continue;
    }
    const load = get().actions.addLoad({
      truckId: truck.id,
      referenceNumber: `${plan.shipper.company.split(/\s+/)[0].toUpperCase().slice(0, 6)}-${plan.date.replace(/-/g, "").slice(2)}`,
      originCity: plan.lane.origin,
      originState: plan.lane.originState,
      destinationCity: plan.lane.destination,
      destinationState: plan.lane.destState,
      miles: plan.lane.miles,
      pickupWindow: `${plan.date} ${plan.lane.pickupTime}`,
      deliveryWindow: plan.date,
      pickupAt: plan.pickupAt,
      rate: plan.lane.rate,
      equipment: plan.lane.equipmentType,
      brokerName: plan.shipper.company,
      brokerEmail: plan.shipper.email || null,
    });
    set((st) => ({ loads: st.loads.map((l) => (l.id === load.id ? { ...l, source: `Contract · ${plan.shipper.company}` } : l)) }));
    made.push(load);
    const key = `${plan.shipper.id}|${plan.lane.id}`;
    if (!through.has(key) || through.get(key)! < plan.date) through.set(key, plan.date);
  }
  for (const [key, date] of through) {
    const [shipperId, laneId] = key.split("|");
    const shipper = get().brokers.find((b) => b.id === shipperId);
    const lane = shipper?.lanes?.find((l) => l.id === laneId);
    if (shipper && lane) saveLane(shipperId, { ...lane, madeThrough: date });
  }
  return { made, noTruck };
}

/** The shipper or broker paid. A bookkeeper's screen asks the database to do it (it's the one load change theirs to make). */
export async function markInvoicePaid(loadId: string, amount: number): Promise<boolean> {
  const s = get();
  const paidAt = new Date().toISOString();
  if (s.session.mode === "books" && s.session.carrierId) {
    const { data, error } = await supabase().rpc("mark_invoice_paid", { p_carrier: s.session.carrierId, p_load: loadId, p_amount: amount, p_paid_at: paidAt });
    if (error || !data) return false;
  }
  set((st) => ({
    loads: st.loads.map((l) => (l.id === loadId && l.invoice ? { ...l, invoice: { ...l.invoice, paidAt, paidAmount: amount } } : l)),
  }));
  return true;
}
