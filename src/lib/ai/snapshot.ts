import { LOAD_STAGE_LABEL, type Broker, type Carrier, type Driver, type Escalation, type Load, type Truck } from "../types";
import type { AgentSettings, Autonomy } from "../store";
import { weekEarnings } from "../earnings";
import { computeDriverPay } from "../settlements";
import { LANG_INFO } from "../lang/pack";
import { PRIMARY_CARRIER_ID } from "../mock-data";

/**
 * The fleet data sent with a question to the real AI: only what that person's screen already shows them, kept
 * small. A driver's snapshot leaves out the broker's rate and the company's profit unless they own the truck.
 */

/** The parts of the app's state a snapshot reads. */
export interface StoreSnapshotSource {
  carriers: Carrier[];
  trucks: Truck[];
  drivers: Driver[];
  loads: Load[];
  brokers: Broker[];
  escalations: Escalation[];
  settings: AgentSettings;
}
type AutonomyLabelMap = Record<Autonomy, string>;

const DONE = new Set(["delivered", "declined", "cancelled"]);
const place = (city: string, state: string) => `${city}, ${state}`;
const laneOf = (l: Load) => `${place(l.lane.origin, l.lane.originState)} → ${place(l.lane.destination, l.lane.destState)}`;
const money = (n: number | null | undefined) => (n == null ? null : Math.round(n));

function brokerName(brokers: Broker[], id: string) {
  return brokers.find((b) => b.id === id)?.company ?? null;
}

export function ownerSnapshot(s: StoreSnapshotSource, autonomyLabel: AutonomyLabelMap) {
  const carrier = s.carriers.find((c) => c.id === PRIMARY_CARRIER_ID);
  const loads = s.loads.filter((l) => l.carrierId === PRIMARY_CARRIER_ID);
  const week = weekEarnings(loads);
  const truckOf = (id: string | null) => s.trucks.find((t) => t.id === id)?.unitNumber ?? null;
  const driverName = (id: string | null | undefined) => s.drivers.find((d) => d.id === id)?.name ?? null;
  const active = loads.filter((l) => !DONE.has(l.stage));
  const brokerIds = new Set(loads.map((l) => l.brokerId));

  return {
    preferredLanguage: LANG_INFO[s.settings.ownerLanguage].english,
    company: carrier ? { name: carrier.name, mc: carrier.mc } : null,
    settings: settingsOf(s.settings, autonomyLabel),
    thisWeek: {
      revenue: money(week.gross),
      profit: money(week.net),
      loads: week.loads.length,
      loadedMiles: Math.round(week.loadedMiles),
      emptyMiles: Math.round(week.emptyMiles),
      detentionAndExtrasBilled: money(week.extras),
    },
    trucks: s.trucks.map((t) => ({
      unit: t.unitNumber,
      driver: driverName(t.driverId),
      teamDriver: driverName(t.secondDriverId),
      status: t.status,
      at: place(t.currentCity, t.currentState),
      currentLoad: s.loads.find((l) => l.id === t.currentLoadId)?.referenceNumber ?? null,
      nextLoad: s.loads.find((l) => l.id === t.nextLoadId)?.referenceNumber ?? null,
    })),
    drivers: s.drivers.map((d) => ({
      name: d.name,
      hoursOfService: d.hosStatus,
      driveHoursLeft: d.hoursRemaining,
      runType: d.runType,
      homeBase: d.homeBase,
      homeTime: d.homeTimeTarget,
      language: LANG_INFO[d.prefs?.language ?? "en"].english,
    })),
    openLoads: active.slice(0, 40).map((l) => ({
      ref: l.referenceNumber,
      lane: laneOf(l),
      miles: l.lane.miles,
      stage: LOAD_STAGE_LABEL[l.stage],
      truck: truckOf(l.truckId),
      pickup: l.pickupWindow,
      delivery: l.deliveryWindow,
      rate: money(l.bookedRate ?? l.targetRate),
      rateIsBooked: l.bookedRate != null,
      profit: money(l.netProfit),
      score: l.score,
      broker: brokerName(s.brokers, l.brokerId),
      rateCon: l.rateCon ? l.rateCon.status : null,
    })),
    recentlyDelivered: loads
      .filter((l) => l.stage === "delivered")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 10)
      .map((l) => ({ ref: l.referenceNumber, lane: laneOf(l), rate: money(l.bookedRate), profit: money(l.netProfit), broker: brokerName(s.brokers, l.brokerId) })),
    needsYou: s.escalations
      .filter((e) => e.carrierId === PRIMARY_CARRIER_ID && e.status !== "resolved")
      .map((e) => ({ reason: e.reason, status: e.status, since: e.createdAt })),
    brokers: s.brokers
      .filter((b) => brokerIds.has(b.id))
      .map((b) => ({ name: b.company, tier: b.tier, avgDaysToPay: b.avgDaysToPay, detentionPaidPct: b.detentionPaidPct, fraudRisk: b.fraudRisk })),
  };
}

export function driverSnapshot(s: StoreSnapshotSource, driverId: string) {
  const driver = s.drivers.find((d) => d.id === driverId);
  if (!driver) return { note: "Driver profile not loaded" };
  const owner = s.settings.ownerOperator;
  const truck = s.trucks.find((t) => t.id === driver.truckId);
  const mine = s.loads.filter((l) => l.truckId === truck?.id);
  const current = mine.find((l) => l.id === truck?.currentLoadId) ?? mine.find((l) => !DONE.has(l.stage) && l.stage !== "offered");
  const next = mine.find((l) => l.id === truck?.nextLoadId);
  const offers = mine.filter((l) => l.stage === "offered");
  const week = weekEarnings(mine);

  return {
    preferredLanguage: LANG_INFO[driver.prefs?.language ?? "en"].english,
    ownsTheTruck: owner,
    you: {
      name: driver.name,
      hoursOfService: driver.hosStatus,
      driveHoursLeft: driver.hoursRemaining,
      homeBase: driver.homeBase,
      homeTime: driver.homeTimeTarget,
      homeDueAt: driver.homeDueAt ?? null,
    },
    truck: truck ? { unit: truck.unitNumber, at: place(truck.currentCity, truck.currentState), status: truck.status } : null,
    currentLoad: current ? loadForDriver(current, driver, s.brokers, owner) : null,
    nextLoad: next ? loadForDriver(next, driver, s.brokers, owner) : null,
    loadOptionsToPick: offers.slice(0, 5).map((l) => loadForDriver(l, driver, s.brokers, owner)),
    thisWeek: owner
      ? { revenue: money(week.gross), profit: money(week.net), loads: week.loads.length }
      : { yourPay: money(week.loads.reduce((sum, l) => sum + computeDriverPay(l, driver), 0)), loads: week.loads.length },
    dispatchPhone: "(469) 555-0199",
  };
}

function loadForDriver(l: Load, driver: Driver, brokers: Broker[], owner: boolean) {
  return {
    ref: l.referenceNumber,
    lane: laneOf(l),
    miles: l.lane.miles,
    emptyMilesToPickup: l.deadheadMiles,
    stage: LOAD_STAGE_LABEL[l.stage],
    pickup: l.pickupWindow,
    delivery: l.deliveryWindow,
    extraStops: (l.stops ?? []).map((st) => `${st.kind} · ${place(st.city, st.state)}${st.completed ? " (done)" : ""}`),
    equipment: l.equipmentType,
    weightLbs: l.weight,
    broker: brokerName(brokers, l.brokerId),
    ...(owner ? { rate: money(l.bookedRate ?? l.targetRate), profit: money(l.netProfit) } : { yourPay: money(computeDriverPay(l, driver)) }),
  };
}

function settingsOf(settings: AgentSettings, autonomyLabel: AutonomyLabelMap) {
  return {
    autopilot: autonomyLabel[settings.autonomy],
    lowestRate: `${settings.rateFloorPct}% of market`,
    ownerOperator: settings.ownerOperator,
  };
}
