import { buildPayRun, weekOf } from "./pay-runs";
import type { Advance, Broker, Driver, FuelTx, Load, PayRun, TollTx, Truck } from "./types";

/**
 * The sample fleet's back office, so the demo shows it working: papers coming due, fuel and tolls on the loads, last
 * week's pay paid and this week's drafted, an advance, a truck with an engine fault, and one direct shipper with a
 * contract lane. Built from the sample loads, so the numbers agree with the rest of the demo.
 */

const DAY = 86400_000;
const TOLL_STATES = new Set(["IL", "IN", "OH", "PA", "NJ", "NY", "OK", "KS", "FL", "TX", "MA", "MD", "WV"]);

export function seedBackOffice(input: { trucks: Truck[]; drivers: Driver[]; loads: Load[]; brokers: Broker[]; carrierId: string; now: number }) {
  const { carrierId, now } = input;
  const day = (offset: number) => new Date(now + offset * DAY).toISOString().slice(0, 10);

  const drivers = input.drivers.map((d, i) => {
    if (d.carrierId !== carrierId) return d;
    const extra: Partial<Driver> = {
      cdlExpires: day(i === 2 ? 25 : 400 + i * 37),
      medCardExpires: day(i === 1 ? 12 : 180 + i * 29),
      taxForm: d.payType === "hourly" ? "w2" : "1099",
    };
    if (i === 0)
      Object.assign(extra, {
        deductions: [
          { id: "ded-occacc", label: "Occupational accident insurance", amount: 45, every: "run" },
          { id: "ded-eld", label: "ELD and tablet", amount: 12, every: "run" },
        ],
        escrow: { perRun: 100, cap: 2500, held: 1400 },
      });
    return { ...d, ...extra };
  });

  const trucks = input.trucks.map((t, i) => {
    if (t.carrierId !== carrierId) return t;
    const extra: Partial<Truck> = { registrationExpires: day(i === 1 ? 9 : 160 + i * 41), odometerAt: new Date(now - 3600_000).toISOString() };
    if (i === 2)
      extra.faults = [{ code: "SPN 3251 FMI 0", description: "DPF differential pressure high: a regen is due", severity: "warn", at: new Date(now - 5 * 3600_000).toISOString(), source: "samsara" }];
    return { ...t, ...extra };
  });

  // One shipper the carrier hauls for directly, on a schedule.
  const shipper: Broker = {
    id: "shipper-lonestar",
    carrierId,
    company: "Lone Star Building Supply",
    contact: "Dana Ortiz",
    phone: "(214) 555-0190",
    email: "ap@lonestarbuilding.example",
    reliability: 92,
    avgResponseMins: 20,
    loadsBooked: 38,
    onTimePct: 100,
    avgRateVariancePct: 0,
    tier: "preferred",
    authorityVerified: true,
    fraudRisk: "low",
    avgDaysToPay: 24,
    detentionPaidPct: 100,
    cancellations90d: 0,
    direct: true,
    terms: 30,
    billingAddress: "4100 Irving Blvd, Dallas, TX 75247",
    lanes: [
      { id: "lane-dal-hou", origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 239, rate: 1150, equipmentType: "Dry Van", days: [1, 3, 5], pickupTime: "07:00", active: true },
      { id: "lane-dal-okc", origin: "Dallas", originState: "TX", destination: "Oklahoma City", destState: "OK", miles: 206, rate: 980, equipmentType: "Flatbed", days: [2], pickupTime: "09:30", active: true },
    ],
  };

  // Fuel and tolls on the loads that ran.
  const fuelTx: FuelTx[] = [];
  const tollTx: TollTx[] = [];
  const ran = input.loads.filter((l) => l.carrierId === carrierId && l.truckId && ["in_transit", "at_delivery", "delivered"].includes(l.stage));
  ran.forEach((l, n) => {
    const truck = trucks.find((t) => t.id === l.truckId)!;
    const date = (l.tripChecklist?.loadedAt ?? l.pickupAt ?? l.updatedAt).slice(0, 10);
    const gallons = Math.round(((l.lane.miles + l.deadheadMiles) / (truck.mpg || 6.5)) * 0.85 * 10) / 10;
    const price = 3.79 + (n % 5) * 0.06;
    fuelTx.push({
      id: `fuel_seed_${n}`, carrierId, date, truckId: truck.id, unit: truck.unitNumber, merchant: n % 2 ? "Love's Travel Stop" : "Pilot Flying J",
      city: l.lane.origin, state: l.lane.originState, gallons, amount: Math.round(gallons * price * 100) / 100, product: "diesel", loadId: l.id, importedAt: new Date(now - DAY).toISOString(),
    });
    if (n % 3 === 0)
      fuelTx.push({ id: `fuel_seed_def_${n}`, carrierId, date, truckId: truck.id, unit: truck.unitNumber, merchant: "Pilot Flying J", city: l.lane.origin, state: l.lane.originState, gallons: 8, amount: 31.92, product: "def", loadId: l.id, importedAt: new Date(now - DAY).toISOString() });
    for (const st of [l.lane.originState, l.lane.destState].filter((s, i, a) => TOLL_STATES.has(s) && a.indexOf(s) === i))
      tollTx.push({ id: `toll_seed_${n}_${st}`, carrierId, date, truckId: truck.id, unit: truck.unitNumber, agency: `${st} Turnpike`, plaza: "Mainline", state: st, amount: 18.5 + (n % 4) * 7.25, loadId: l.id, importedAt: new Date(now - DAY).toISOString() });
  });

  // An advance this week, and pay: last week paid, this week a draft.
  const marcus = drivers.find((d) => d.carrierId === carrierId)!;
  const advances: Advance[] = [{ id: "adv-seed-1", carrierId, driverId: marcus.id, amount: 200, note: "Cash for a lumper the receiver wouldn't bill", at: new Date(now - 2 * DAY).toISOString() }];
  const thisWeek = weekOf(new Date(now).toISOString());
  const lastWeek = weekOf(new Date(now - 7 * DAY).toISOString());
  const payRuns: PayRun[] = [];
  for (const d of drivers.filter((x) => x.carrierId === carrierId)) {
    const last = buildPayRun({ driver: d, period: lastWeek, loads: input.loads, trucks, expenses: [], advances: [], runs: payRuns, now: new Date(now).toISOString() });
    if (last.gross > 0) payRuns.push({ ...last, status: "paid", paidAt: new Date(Date.parse(`${last.periodEnd}T12:00:00Z`) + 4 * DAY).toISOString() });
    const cur = buildPayRun({ driver: d, period: thisWeek, loads: input.loads, trucks, expenses: [], advances, runs: payRuns, now: new Date(now).toISOString() });
    if (cur.gross > 0) payRuns.push(cur);
  }

  return { drivers, trucks, brokers: [...input.brokers, shipper], fuelTx, tollTx, payRuns, advances, contractLoads: [] as Load[] };
}
