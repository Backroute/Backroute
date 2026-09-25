import "server-only";
import type { Item } from "../cloud/rows";
import { roadMiles, roughCoords } from "../trip-geo";
import { formatAtStop } from "../stop-time";
import type { Driver, HosStatus, Truck } from "../types";
import { claimMark, save, type CarrierContext } from "./db";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";

/**
 * The carrier's ELD (Samsara or Motive): where each truck is and how many hours each driver has left. The AI uses it
 * the way a dispatcher watches the map: to book only loads a driver can legally reach, and to tell a broker a truck
 * is running late before the appointment is missed rather than after.
 *
 * Samsara: GET /fleet/vehicles/stats?types=gps and GET /fleet/hos/clocks, with a Bearer token.
 * Motive:  GET /v1/vehicle_locations and GET /v1/available_time, with an X-Api-Key header.
 */

export type EldKind = "samsara" | "motive";

export interface EldVehicle {
  unit: string;
  lat: number;
  lon: number;
  at: string;
  description?: string;
}
export interface EldClock {
  driverName: string;
  /** Hours left. */
  drive: number;
  shift: number;
  cycle: number;
  status: HosStatus;
}

const SAMSARA = () => process.env.SAMSARA_API_BASE?.replace(/\/$/, "") ?? "https://api.samsara.com";
const MOTIVE = () => process.env.MOTIVE_API_BASE?.replace(/\/$/, "") ?? "https://api.gomotive.com";

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new EldError("The ELD didn't accept the key.");
  if (!res.ok) throw new EldError(`The ELD answered ${res.status}.`);
  return res.json();
}

export class EldError extends Error {}

const samsaraStatus: Record<string, HosStatus> = { driving: "driving", onDuty: "on_duty", yardMove: "on_duty", offDuty: "off_duty", personalConveyance: "off_duty", sleeperBed: "sleeper" };
const motiveStatus: Record<string, HosStatus> = { driving: "driving", on_duty: "on_duty", yard_move: "on_duty", off_duty: "off_duty", personal_conveyance: "off_duty", sleeper: "sleeper", sleeper_berth: "sleeper" };

/** Reads every vehicle's position and every driver's clocks. Throws EldError when the key or the service fails. */
export async function readEld(kind: EldKind, apiKey: string): Promise<{ vehicles: EldVehicle[]; clocks: EldClock[] }> {
  const vehicles: EldVehicle[] = [];
  const clocks: EldClock[] = [];
  if (kind === "samsara") {
    const auth = { authorization: `Bearer ${apiKey}` };
    let after = "";
    for (let page = 0; page < 20; page++) {
      const body = (await getJson(`${SAMSARA()}/fleet/vehicles/stats?types=gps${after ? `&after=${encodeURIComponent(after)}` : ""}`, auth)) as {
        data?: { name?: string; gps?: { time?: string; latitude?: number; longitude?: number; reverseGeo?: { formattedLocation?: string } } }[];
        pagination?: { endCursor?: string; hasNextPage?: boolean };
      };
      for (const v of body.data ?? []) if (v.name && v.gps?.latitude != null && v.gps.longitude != null) vehicles.push({ unit: v.name, lat: v.gps.latitude, lon: v.gps.longitude, at: v.gps.time ?? new Date().toISOString(), description: v.gps.reverseGeo?.formattedLocation });
      if (!body.pagination?.hasNextPage || !body.pagination.endCursor) break;
      after = body.pagination.endCursor;
    }
    after = "";
    for (let page = 0; page < 20; page++) {
      const body = (await getJson(`${SAMSARA()}/fleet/hos/clocks${after ? `?after=${encodeURIComponent(after)}` : ""}`, auth)) as {
        data?: { driver?: { name?: string }; clocks?: { drive?: { driveRemainingDurationMs?: number }; shift?: { shiftRemainingDurationMs?: number }; cycle?: { cycleRemainingDurationMs?: number } }; currentDutyStatus?: { hosStatusType?: string } }[];
        pagination?: { endCursor?: string; hasNextPage?: boolean };
      };
      for (const c of body.data ?? [])
        if (c.driver?.name)
          clocks.push({
            driverName: c.driver.name,
            drive: (c.clocks?.drive?.driveRemainingDurationMs ?? 0) / 3600_000,
            shift: (c.clocks?.shift?.shiftRemainingDurationMs ?? 0) / 3600_000,
            cycle: (c.clocks?.cycle?.cycleRemainingDurationMs ?? 0) / 3600_000,
            status: samsaraStatus[c.currentDutyStatus?.hosStatusType ?? ""] ?? "off_duty",
          });
      if (!body.pagination?.hasNextPage || !body.pagination.endCursor) break;
      after = body.pagination.endCursor;
    }
  } else {
    const auth = { "x-api-key": apiKey };
    for (let page = 1; page <= 20; page++) {
      const body = (await getJson(`${MOTIVE()}/v1/vehicle_locations?per_page=100&page_no=${page}`, auth)) as {
        vehicles?: { vehicle?: { number?: string; current_location?: { lat?: number; lon?: number; located_at?: string; description?: string } } }[];
        pagination?: { per_page?: number; page_no?: number; total?: number };
      };
      for (const { vehicle: v } of body.vehicles ?? []) {
        const loc = v?.current_location;
        if (v?.number && loc?.lat != null && loc.lon != null) vehicles.push({ unit: v.number, lat: loc.lat, lon: loc.lon, at: loc.located_at ?? new Date().toISOString(), description: loc.description });
      }
      const p = body.pagination;
      if (!p || (p.page_no ?? page) * (p.per_page ?? 100) >= (p.total ?? 0)) break;
    }
    for (let page = 1; page <= 20; page++) {
      const body = (await getJson(`${MOTIVE()}/v1/available_time?per_page=100&page_no=${page}`, auth)) as {
        users?: { user?: { first_name?: string; last_name?: string; duty_status?: string; available_time?: { drive?: number; shift?: number; cycle?: number } } }[];
        pagination?: { per_page?: number; page_no?: number; total?: number };
      };
      for (const { user: u } of body.users ?? [])
        if (u?.first_name || u?.last_name)
          clocks.push({
            driverName: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(),
            drive: (u.available_time?.drive ?? 0) / 3600,
            shift: (u.available_time?.shift ?? 0) / 3600,
            cycle: (u.available_time?.cycle ?? 0) / 3600,
            status: motiveStatus[u.duty_status ?? ""] ?? "off_duty",
          });
      const p = body.pagination;
      if (!p || (p.page_no ?? page) * (p.per_page ?? 100) >= (p.total ?? 0)) break;
    }
  }
  return { vehicles, clocks };
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const sameUnit = (a: string, b: string) => {
  const x = key(a).replace(/^(truck|unit|trk)/, "");
  const y = key(b).replace(/^(truck|unit|trk)/, "");
  return !!x && !!y && (x === y || (x.length >= 2 && y.length >= 2 && (x.endsWith(y) || y.endsWith(x))));
};
const sameName = (a: string, b: string) => key(a) === key(b) || key(a.split(/\s+/).reverse().join("")) === key(b);

/** "Dallas, TX" or "1200 Main St, Dallas, TX 75201" → city and state. */
export function cityState(description?: string): { city: string; state: string } | null {
  const m = description?.match(/([A-Za-z .'-]+),\s*([A-Z]{2})\b(?:\s*\d{5})?(?:,?\s*(?:USA|US|Canada))?\s*$/);
  return m ? { city: m[1].trim(), state: m[2] } : null;
}

/** Puts what the ELD said on the trucks and drivers it matches. Returns the units and drivers it couldn't match. */
export async function applyEld(ctx: CarrierContext, kind: EldKind, data: { vehicles: EldVehicle[]; clocks: EldClock[] }): Promise<{ trucks: number; drivers: number; unmatched: string[] }> {
  let trucks = 0;
  let drivers = 0;
  const unmatched: string[] = [];
  for (const v of data.vehicles) {
    const truck = ctx.trucks.find((t) => sameUnit(t.unitNumber, v.unit));
    if (!truck) {
      unmatched.push(`truck ${v.unit}`);
      continue;
    }
    const place = cityState(v.description);
    const next: Truck = { ...truck, position: { lat: v.lat, lon: v.lon, at: v.at, description: v.description, source: kind }, ...(place ? { currentCity: place.city, currentState: place.state } : {}) };
    await save("trucks", ctx.carrier.id, next as unknown as Item);
    ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? next : t));
    trucks++;
  }
  const at = new Date().toISOString();
  for (const c of data.clocks) {
    const driver = ctx.drivers.find((d) => sameName(d.name, c.driverName));
    if (!driver) {
      unmatched.push(`driver ${c.driverName}`);
      continue;
    }
    const round = (h: number) => Math.round(h * 10) / 10;
    const next: Driver = { ...driver, hos: { drive: round(c.drive), shift: round(c.shift), cycle: round(c.cycle), at, source: kind }, hoursRemaining: round(Math.min(c.drive, c.shift)), hosStatus: c.status };
    await save("drivers", ctx.carrier.id, next as unknown as Item);
    ctx.drivers = ctx.drivers.map((d) => (d.id === driver.id ? next : d));
    drivers++;
  }
  return { trucks, drivers, unmatched };
}

const HOUR = 3600_000;
const MPH = 50;
/** A 10-hour break when the driver's drive or shift clock runs out on the way. */
const RESET_HOURS = 10;

/** When the truck gets there, from where it is now and the driver's hours. Null when there's nothing solid to go on. */
export function etaTo(truck: Truck, driver: Driver | undefined, city: string, state: string, now: number): number | null {
  const pos = truck.position;
  const target = roughCoords(city, state);
  if (!pos || !target?.exact || now - Date.parse(pos.at) > 30 * 60_000) return null;
  const hours = roadMiles([pos.lat, pos.lon], target.at) / MPH;
  const clocksFresh = driver?.hos && now - Date.parse(driver.hos.at) < 2 * HOUR;
  const left = clocksFresh ? Math.min(driver!.hos!.drive, driver!.hos!.shift) : Infinity;
  return now + (hours + (hours > left ? RESET_HOURS : 0)) * HOUR;
}

/** Trucks that will miss their appointment by more than 30 minutes: the broker hears now, once per stop. */
export async function lateNotices(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    const stop = load.stage === "dispatched" ? "pickup" : load.stage === "in_transit" ? "delivery" : null;
    const due = stop === "pickup" ? load.pickupAt : stop === "delivery" ? load.deliveryAt : undefined;
    if (!stop || !due) continue;
    const truck = ctx.trucks.find((t) => t.id === load.truckId);
    const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
    const [city, state] = stop === "pickup" ? [load.lane.origin, load.lane.originState] : [load.lane.destination, load.lane.destState];
    const eta = truck ? etaTo(truck, driver, city, state, now) : null;
    if (!eta || eta <= Date.parse(due) + 30 * 60_000) continue;
    const to = load.brokerContactEmail ?? ctx.brokers.find((b) => b.id === load.brokerId)?.email;
    if (!to || !(await claimMark(ctx.carrier.id, load.id, `late_notice_${stop}`))) continue;
    const etaText = formatAtStop(new Date(eta).toISOString(), state);
    const result = await sendOrQueue(ctx, {
      purpose: "eta_update",
      to,
      subject: mail.subjectFor(load, "Running late"),
      body: mail.etaUpdate(ctx.carrier, ctx.settings, load, stop, `${city}, ${state}`, etaText),
      loadId: load.id,
      withinRules: true,
      why: `Truck ${truck!.unitNumber} won't make the ${stop} on ${load.referenceNumber} on time (ETA ${etaText}). Tell the broker?`,
    });
    done.push(`${load.referenceNumber}: late notice for ${stop} ${result}`);
  }
  return done;
}

/** Whether a driver can legally get a truck to a pickup in time, from the ELD's clocks. True when there's no ELD data. */
export function canMakePickup(driver: Driver | undefined, deadheadMiles: number, loadedMiles: number, pickupAt: number | null, now: number): boolean {
  const hos = driver?.hos;
  if (!hos || now - Date.parse(hos.at) > 2 * HOUR) return true;
  const toPickup = deadheadMiles / MPH;
  const needs = toPickup + loadedMiles / MPH;
  if (hos.cycle < Math.min(needs, 11)) return false; // Out of weekly hours: needs a 34-hour restart first.
  if (!pickupAt) return true;
  const arrive = now + (toPickup + (toPickup > Math.min(hos.drive, hos.shift) ? RESET_HOURS : 0)) * HOUR;
  return arrive <= pickupAt;
}

