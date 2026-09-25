import { PRIMARY_CARRIER_ID } from "./mock-data";
import { HOME_TIME_OPTIONS } from "./run-types";
import { computeEconomics, computeLoadScore } from "./scoring";
import { cityCoords, distanceMiles } from "./trip-geo";
import type { Broker, Driver, EquipmentType, Load, RunType, Truck } from "./types";

/**
 * A real fleet, entered by the owner: trucks and drivers typed in at sign-up or on the Fleet page, and loads added
 * by hand or read off a rate con. No sample data. The app's own carrier id is used inside the app; the database
 * keeps the real one.
 */

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const iso = (daysFromNow = 0) => new Date(Date.now() + daysFromNow * 86400000).toISOString();

export interface FleetEntry {
  driverName: string;
  phone: string;
  unitNumber: string;
  equipment: EquipmentType;
  homeCity: string;
  homeState: string;
  runType: RunType;
}

export function makeTruckAndDriver(entry: FleetEntry): { truck: Truck; driver: Driver } {
  const truckId = uid("truck");
  const driverId = uid("driver");
  const homeBase = `${entry.homeCity.trim()}, ${entry.homeState.trim().toUpperCase()}`;
  const truck: Truck = {
    id: truckId,
    unitNumber: entry.unitNumber.trim(),
    driverId,
    carrierId: PRIMARY_CARRIER_ID,
    equipmentType: entry.equipment,
    status: "available",
    currentCity: entry.homeCity.trim(),
    currentState: entry.homeState.trim().toUpperCase(),
    homeBase,
    currentLoadId: null,
    nextLoadId: null,
    mpg: 6.5,
    odometer: 0,
    lastServiceMiles: 0,
    serviceIntervalMiles: 25000,
    nextInspectionDue: iso(365),
  };
  const driver: Driver = {
    id: driverId,
    name: entry.driverName.trim(),
    phone: entry.phone.trim(),
    email: "",
    truckId,
    carrierId: PRIMARY_CARRIER_ID,
    hosStatus: "off_duty",
    hoursRemaining: 11,
    cdl: "",
    rating: 5,
    hireDate: iso(),
    homeBase,
    runType: entry.runType,
    homeTimeTarget: HOME_TIME_OPTIONS[entry.runType][0],
    payType: entry.runType === "local" ? "hourly" : entry.runType === "intown" ? "per_move" : "percentage",
    payRate: entry.runType === "local" ? 28 : entry.runType === "intown" ? 75 : 0.28,
  };
  return { truck, driver };
}

/** A broker the carrier works with, added the first time a load names them. Stats start neutral until real history builds up. */
export function makeBroker(company: string, email?: string | null): Broker {
  return {
    id: uid("broker"),
    carrierId: PRIMARY_CARRIER_ID,
    company: company.trim(),
    contact: "",
    phone: "",
    email: email?.trim() ?? "",
    reliability: 80,
    avgResponseMins: 30,
    loadsBooked: 0,
    onTimePct: 100,
    avgRateVariancePct: 0,
    tier: "standard",
    authorityVerified: false,
    fraudRisk: "low",
    avgDaysToPay: 30,
    detentionPaidPct: 0,
    cancellations90d: 0,
  };
}

export interface NewLoad {
  truckId: string;
  brokerId: string;
  referenceNumber: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  miles?: number;
  pickupWindow: string;
  deliveryWindow: string;
  /** The appointments as instants (see lib/stop-time), for check-ins and detention. */
  pickupAt?: string;
  deliveryAt?: string;
  rate: number;
  equipment: EquipmentType;
  weight?: number;
}

/** Road miles from the straight line between two known cities (about 1.2×), when the owner doesn't give them. */
export function estimateMiles(a: { city: string; state: string }, b: { city: string; state: string }): number | null {
  const p = cityCoords(a.city.trim(), a.state.trim().toUpperCase());
  const q = cityCoords(b.city.trim(), b.state.trim().toUpperCase());
  return p && q ? Math.round(distanceMiles(p, q) * 1.2) : null;
}

/** A booked load, with the same cost and profit math as every other load in the app. */
export function makeLoad(input: NewLoad, broker: Broker, truck: Truck, stage: "dispatched" | "booked" | "offered", deadheadMiles = 0): Load {
  const miles = Math.max(1, Math.round(input.miles ?? estimateMiles({ city: input.originCity, state: input.originState }, { city: input.destinationCity, state: input.destinationState }) ?? 500));
  const fuelCost = Math.round((miles / truck.mpg) * 3.9);
  const tollCost = 0;
  const econ = computeEconomics(input.rate, miles, deadheadMiles, fuelCost, tollCost);
  const now = iso();
  return {
    id: uid("load"),
    referenceNumber: input.referenceNumber.trim() || uid("REF").toUpperCase(),
    stage,
    source: "Added by you",
    brokerId: broker.id,
    lane: {
      origin: input.originCity.trim(),
      originState: input.originState.trim().toUpperCase(),
      destination: input.destinationCity.trim(),
      destState: input.destinationState.trim().toUpperCase(),
      miles,
      marketRpm: Math.round((input.rate / miles) * 100) / 100,
    },
    equipmentType: input.equipment,
    weight: input.weight ?? 0,
    pickupWindow: input.pickupWindow.trim(),
    deliveryWindow: input.deliveryWindow.trim(),
    ...(input.pickupAt ? { pickupAt: input.pickupAt } : {}),
    ...(input.deliveryAt ? { deliveryAt: input.deliveryAt } : {}),
    listedRate: input.rate,
    targetRate: input.rate,
    bookedRate: input.rate,
    deadheadMiles,
    fuelCost,
    tollCost,
    deadheadCost: econ.deadheadCost,
    commission: econ.commission,
    netProfit: econ.netProfit,
    rpm: econ.rpm,
    score: computeLoadScore({ rate: input.rate, netProfit: econ.netProfit, miles, deadheadMiles, rpm: econ.rpm, marketRpm: econ.rpm, brokerReliability: broker.reliability }),
    carrierId: PRIMARY_CARRIER_ID,
    truckId: truck.id,
    messages: [],
    calls: [],
    documents: [],
    createdAt: now,
    updatedAt: now,
    isChained: stage === "booked",
    aiConfidence: 100,
    ticksInStage: 0,
    progressPct: stage === "dispatched" ? 5 : 0,
  };
}

/** The equipment a rate con or broker email names, in the app's four kinds. */
export const guessEquipment = (text: string | null | undefined): EquipmentType | null =>
  !text ? null : /reefer|refrig/i.test(text) ? "Reefer" : /flat|step ?deck/i.test(text) ? "Flatbed" : /container|chassis/i.test(text) ? "Container" : /van/i.test(text) ? "Dry Van" : null;
