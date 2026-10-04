import "server-only";
import type { Item } from "../cloud/rows";
import { roadMiles, roughCoords } from "../trip-geo";
import { formatAtStop } from "../stop-time";
import type { Driver, HosStatus, Load, Truck, TruckFault } from "../types";
import { faultAdvice, faultSeverity } from "../maintenance";
import { canCall, textTo } from "../channels/out";
import { needAppointment } from "./appointments";
import { pushToOffice } from "../push";
import { addActivity, claimMark, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { event } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import { routedEta } from "./routing";
import { etaWithReasons, stillSince, stoppedOddly } from "./late-risk";
import { translateForDriver } from "../ai/translate";
import * as mail from "./templates";
import { addWhy } from "./why";
import { tripEtas } from "./trips";

/**
 * The carrier's ELD (Samsara or Motive): where each truck is and how many hours each driver has left. The AI uses it
 * the way a dispatcher watches the map: to book only loads a driver can legally reach, and to tell a broker a truck
 * is running late before the appointment is missed rather than after.
 *
 * Samsara: GET /fleet/vehicles/stats?types=gps and GET /fleet/hos/clocks, with a Bearer token.
 * Motive:  GET /v1/vehicle_locations and GET /v1/available_time, with an X-Api-Key header.
 *
 * Also the truck's own health, so maintenance runs on real miles: the odometer (Samsara obdOdometerMeters, Motive's
 * odometer on the vehicle) and engine fault codes (Samsara faultCodes, Motive /v1/fault_codes). Those two are read
 * when the account allows it and skipped quietly when it doesn't.
 */

export type EldKind = "samsara" | "motive";

export interface EldVehicle {
  unit: string;
  lat: number;
  lon: number;
  at: string;
  description?: string;
  odometerMiles?: number;
}
export interface EldFault {
  unit: string;
  code: string;
  description: string;
  lamp?: "red" | "amber" | "protect" | "mil" | null;
  at: string;
}
export interface EldClock {
  driverName: string;
  /** Hours left. */
  drive: number;
  shift: number;
  cycle: number;
  status: HosStatus;
  /** Personal conveyance: driving the truck on their own time, off duty. */
  personal?: boolean;
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
export async function readEld(kind: EldKind, apiKey: string): Promise<{ vehicles: EldVehicle[]; clocks: EldClock[]; faults: EldFault[] }> {
  const vehicles: EldVehicle[] = [];
  const clocks: EldClock[] = [];
  const faults: EldFault[] = [];
  if (kind === "samsara") {
    const auth = { authorization: `Bearer ${apiKey}` };
    let after = "";
    for (let page = 0; page < 20; page++) {
      const body = (await getJson(`${SAMSARA()}/fleet/vehicles/stats?types=gps,obdOdometerMeters${after ? `&after=${encodeURIComponent(after)}` : ""}`, auth)) as {
        data?: { name?: string; gps?: { time?: string; latitude?: number; longitude?: number; reverseGeo?: { formattedLocation?: string } }; obdOdometerMeters?: { value?: number } }[];
        pagination?: { endCursor?: string; hasNextPage?: boolean };
      };
      for (const v of body.data ?? [])
        if (v.name && v.gps?.latitude != null && v.gps.longitude != null)
          vehicles.push({
            unit: v.name,
            lat: v.gps.latitude,
            lon: v.gps.longitude,
            at: v.gps.time ?? new Date().toISOString(),
            description: v.gps.reverseGeo?.formattedLocation,
            ...(v.obdOdometerMeters?.value ? { odometerMiles: Math.round(v.obdOdometerMeters.value / 1609.344) } : {}),
          });
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
            personal: c.currentDutyStatus?.hosStatusType === "personalConveyance",
          });
      if (!body.pagination?.hasNextPage || !body.pagination.endCursor) break;
      after = body.pagination.endCursor;
    }
    faults.push(...(await samsaraFaults(auth).catch(() => [])));
  } else {
    const auth = { "x-api-key": apiKey };
    for (let page = 1; page <= 20; page++) {
      const body = (await getJson(`${MOTIVE()}/v1/vehicle_locations?per_page=100&page_no=${page}`, auth)) as {
        vehicles?: { vehicle?: { number?: string; current_location?: { lat?: number; lon?: number; located_at?: string; description?: string; odometer?: number } } }[];
        pagination?: { per_page?: number; page_no?: number; total?: number };
      };
      for (const { vehicle: v } of body.vehicles ?? []) {
        const loc = v?.current_location;
        if (v?.number && loc?.lat != null && loc.lon != null)
          vehicles.push({ unit: v.number, lat: loc.lat, lon: loc.lon, at: loc.located_at ?? new Date().toISOString(), description: loc.description, ...(loc.odometer ? { odometerMiles: Math.round(loc.odometer) } : {}) });
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
            personal: u.duty_status === "personal_conveyance",
          });
      const p = body.pagination;
      if (!p || (p.page_no ?? page) * (p.per_page ?? 100) >= (p.total ?? 0)) break;
    }
    faults.push(...(await motiveFaults(auth).catch(() => [])));
  }
  return { vehicles, clocks, faults };
}

/** Active engine codes per truck (J1939 SPN/FMI), with the lamp they lit. */
async function samsaraFaults(auth: Record<string, string>): Promise<EldFault[]> {
  const body = (await getJson(`${SAMSARA()}/fleet/vehicles/stats?types=faultCodes`, auth)) as {
    data?: {
      name?: string;
      faultCodes?: {
        time?: string;
        j1939?: { diagnosticTroubleCodes?: { spnId?: number; fmiId?: number; spnDescription?: string; fmiDescription?: string }[]; checkEngineLights?: { stopIsOn?: boolean; warningIsOn?: boolean; protectIsOn?: boolean; emissionsIsOn?: boolean } };
      };
    }[];
  };
  const out: EldFault[] = [];
  for (const v of body.data ?? []) {
    const j = v.faultCodes?.j1939;
    if (!v.name || !j) continue;
    const lamps = j.checkEngineLights;
    const lamp = lamps?.stopIsOn ? "red" : lamps?.protectIsOn ? "protect" : lamps?.warningIsOn ? "amber" : lamps?.emissionsIsOn ? "mil" : null;
    for (const d of j.diagnosticTroubleCodes ?? [])
      out.push({ unit: v.name, code: `SPN ${d.spnId ?? "?"} FMI ${d.fmiId ?? "?"}`, description: [d.spnDescription, d.fmiDescription].filter(Boolean).join(": ") || "Engine fault", lamp, at: v.faultCodes?.time ?? new Date().toISOString() });
  }
  return out;
}

async function motiveFaults(auth: Record<string, string>): Promise<EldFault[]> {
  const body = (await getJson(`${MOTIVE()}/v1/fault_codes?per_page=100&status=open`, auth)) as {
    fault_codes?: { fault_code?: { code?: string; code_label?: string; code_description?: string; status?: string; last_observed_at?: string; lamp?: string; vehicle?: { number?: string } } }[];
  };
  return (body.fault_codes ?? [])
    .map((x) => x.fault_code)
    .filter((f): f is NonNullable<typeof f> => !!f?.vehicle?.number && !!f.code && f.status !== "closed")
    .map((f) => ({ unit: f.vehicle!.number!, code: f.code!, description: f.code_description || f.code_label || "Engine fault", lamp: /red|stop/i.test(f.lamp ?? "") ? "red" : /amber|warn/i.test(f.lamp ?? "") ? "amber" : null, at: f.last_observed_at ?? new Date().toISOString() }));
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
export async function applyEld(ctx: CarrierContext, kind: EldKind, data: { vehicles: EldVehicle[]; clocks: EldClock[]; faults?: EldFault[] }): Promise<{ trucks: number; drivers: number; unmatched: string[] }> {
  let trucks = 0;
  let drivers = 0;
  const unmatched: string[] = [];
  const at = new Date().toISOString();
  const personalNow = new Set<string>();
  for (const c of data.clocks) {
    const driver = ctx.drivers.find((d) => sameName(d.name, c.driverName));
    if (!driver) {
      unmatched.push(`driver ${c.driverName}`);
      continue;
    }
    if (c.personal) personalNow.add(driver.id);
    const round = (h: number) => Math.round(h * 10) / 10;
    const next: Driver = { ...driver, hos: { drive: round(c.drive), shift: round(c.shift), cycle: round(c.cycle), at, source: kind }, hoursRemaining: round(Math.min(c.drive, c.shift)), hosStatus: c.status };
    await save("drivers", ctx.carrier.id, next as unknown as Item);
    ctx.drivers = ctx.drivers.map((d) => (d.id === driver.id ? next : d));
    drivers++;
  }
  for (const v of data.vehicles) {
    const truck = ctx.trucks.find((t) => sameUnit(t.unitNumber, v.unit));
    if (!truck) {
      unmatched.push(`truck ${v.unit}`);
      continue;
    }
    const place = cityState(v.description);
    // Personal conveyance (the driver using the truck on their own time) isn't followed: the last spot stays. Parked
    // off duty or in the sleeper, the truck's spot still comes in, since that's where the AI finds its next load.
    // Odometer and engine codes always come in.
    const driver = ctx.drivers.find((d) => d.id === truck.driverId);
    const personal = !!driver && personalNow.has(driver.id);
    const next: Truck = {
      ...truck,
      ...(personal && truck.position
        ? {}
        : {
            position: { lat: v.lat, lon: v.lon, at: v.at, description: v.description, source: kind },
            stoppedSince: stillSince(truck.position, v, truck.stoppedSince),
            ...(place ? { currentCity: place.city, currentState: place.state } : {}),
          }),
      // The odometer only goes up: a reading lower than what's known (a swapped ECU) is left alone.
      ...(v.odometerMiles && v.odometerMiles >= (truck.odometer ?? 0) ? { odometer: v.odometerMiles, odometerAt: v.at } : {}),
      ...(data.faults ? { faults: await faultsFor(ctx, truck, kind, data.faults.filter((f) => sameUnit(truck.unitNumber, f.unit))) } : {}),
    };
    await save("trucks", ctx.carrier.id, next as unknown as Item);
    ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? next : t));
    trucks++;
  }
  return { trucks, drivers, unmatched };
}

/** The truck's open codes now: kept as first seen, new ones added; a new one that means stop reaches the owner at once. */
async function faultsFor(ctx: CarrierContext, truck: Truck, kind: EldKind, reported: EldFault[]): Promise<TruckFault[]> {
  const before = new Map((truck.faults ?? []).filter((f) => f.source === "manual").map((f) => [f.code, f]));
  const out: TruckFault[] = [...before.values()];
  for (const r of reported) {
    if (out.some((f) => f.code === r.code)) continue;
    const old = truck.faults?.find((f) => f.code === r.code);
    const severity = faultSeverity(r);
    out.push({ code: r.code, description: r.description, severity, at: old?.at ?? r.at, source: kind });
    if (!old && severity === "critical" && (await claimMark(ctx.carrier.id, "faults", `${truck.id}:${r.code}`))) {
      await addActivity(ctx.carrier.id, event({ type: "maintenance", message: `${truck.unitNumber}: ${r.description}`, detail: `${r.code} · ${faultAdvice("critical")}`, severity: "danger" }));
      await pushToOffice(ctx.carrier.id, { title: `${truck.unitNumber} engine fault`, body: `${r.description}. ${faultAdvice("critical")}`, url: "/carrier/maintenance", tag: `fault-${truck.id}-${r.code}` }).catch(() => 0);
    }
  }
  return out;
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
export async function lateNotices(ctx: CarrierContext, now: number, opts: { email?: boolean } = { email: true }): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    const stop = load.stage === "dispatched" ? "pickup" : load.stage === "in_transit" ? "delivery" : null;
    const due = stop === "pickup" ? load.pickupAt : stop === "delivery" ? load.deliveryAt : undefined;
    if (!stop || !due) continue;
    const truck = ctx.trucks.find((t) => t.id === load.truckId);
    const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
    const [city, state] = stop === "pickup" ? [load.lane.origin, load.lane.originState] : [load.lane.destination, load.lane.destState];
    // On a multi-load trip the truck is checked once, on the load it's working; a stop further down the trip is
    // reached through the ones before it (lib/agent/trips).
    const ahead = truck?.trip && load.tripId === truck.trip.id && truck.currentLoadId !== load.id ? tripEtas(ctx, truck, now)?.get(`${load.id}:${stop}`) : undefined;
    if (truck && (!truck.trip || truck.currentLoadId === load.id) && (await stoppedCheck(ctx, load, truck, driver, now))) done.push(`${load.referenceNumber}: checked on the driver (truck stopped)`);
    const seen = truck && ahead === undefined ? await etaWithReasons(truck, driver, city, state, now) : null;
    const eta = ahead ?? seen?.at ?? (truck ? etaTo(truck, driver, city, state, now) : null);
    const because = seen?.reasons.length ? ` (${seen.reasons.join("; ")})` : "";
    if (!eta) continue;
    // Close: the owner hears it's tight while there's still time to do something, before anyone is late.
    if (eta > Date.parse(due) - 30 * 60_000 && eta <= Date.parse(due) + 30 * 60_000) {
      if (seen?.reasons.length && (await claimMark(ctx.carrier.id, load.id, `late_risk_${stop}`))) {
        const etaText = formatAtStop(new Date(eta).toISOString(), state);
        const line = `Tight on time to the ${stop} in ${city}, ${state}: arriving about ${etaText}${because}. The AI is watching it and will tell the broker if it slips.`;
        const marked = addWhy(load, line);
        await save("loads", ctx.carrier.id, marked as unknown as Item);
        ctx.loads = ctx.loads.map((l) => (l.id === load.id ? marked : l));
        await pushToOffice(ctx.carrier.id, { title: `Truck ${truck!.unitNumber} tight on time`, body: `${load.referenceNumber}: ${line}`, url: `/carrier/loads/${load.id}`, tag: `late-${load.id}-${stop}` }).catch(() => 0);
        // The driver hears it too, without being told to hurry: the AI handles the dock and the broker.
        if (driver) await textDriver(ctx, driver, `Heads-up on ${load.referenceNumber}: ${seen.reasons.join(", ")}. You're looking at about ${etaText} for the ${stop} in ${city}. Drive safe, no need to rush: I'll handle the ${stop === "pickup" ? "shipper" : "receiver"} and the broker if it slips.`, { kind: "late_risk", loadId: load.id }, now);
        done.push(`${load.referenceNumber}: tight on time to the ${stop}`);
      }
      continue;
    }
    if (eta <= Date.parse(due) + 30 * 60_000) continue;
    // The appointment will be missed: call the facility to move it, the way a dispatcher does before the truck is late.
    const phone = stop === "pickup" ? load.rateConReading?.shipperPhone : load.rateConReading?.receiverPhone;
    if (phone && canCall(ctx.carrier) && load.appointments?.[stop]?.purpose !== "move" && (await claimMark(ctx.carrier.id, load.id, `appt_move_${stop}`)))
      done.push(`${load.referenceNumber}: ${await needAppointment(ctx, load, stop, "move", eta, now)}`);
    const to = load.brokerContactEmail ?? ctx.brokers.find((b) => b.id === load.brokerId)?.email;
    if (!(await claimMark(ctx.carrier.id, load.id, `late_notice_${stop}`))) continue;
    const etaText = formatAtStop(new Date(eta).toISOString(), state);
    // The broker hears by email (with why, in a few words); with no email to send from, the owner is told to call.
    const result =
      to && opts.email !== false
        ? await sendOrQueue(ctx, {
            purpose: "eta_update",
            to,
            subject: mail.subjectFor(load, "Running late"),
            body: mail.etaUpdate(ctx.carrier, ctx.settings, load, stop, `${city}, ${state}`, etaText, seen?.reasons.filter((r) => !/hours run out/.test(r)).join("; ") || undefined),
            loadId: load.id,
            withinRules: true,
            why: `Truck ${truck!.unitNumber} won't make the ${stop} on ${load.referenceNumber} on time (ETA ${etaText}). Tell the broker?`,
          })
        : "not_emailed";
    done.push(`${load.referenceNumber}: late notice for ${stop} ${result}`);
    // The owner hears it the same moment, with the new time, before anyone has to ask them.
    const line = `Running late to the ${stop} in ${city}, ${state}: new arrival about ${etaText}${because}. ${result === "sent" ? "The AI told the broker." : result === "not_emailed" ? "Broker email isn't set up: give them a call." : "The note to the broker is waiting for your OK."}`;
    const marked = addWhy({ ...load, late: { stop, eta: new Date(eta).toISOString(), at: new Date(now).toISOString() } }, line);
    await save("loads", ctx.carrier.id, marked as unknown as Item);
    ctx.loads = ctx.loads.map((l) => (l.id === load.id ? marked : l));
    await addActivity(ctx.carrier.id, event({ type: "check_call", loadId: load.id, message: `Truck ${truck!.unitNumber} running late on ${load.referenceNumber}`, detail: line, severity: "warning" }));
    await pushToOffice(ctx.carrier.id, { title: `Truck ${truck!.unitNumber} running late`, body: `${load.referenceNumber}: ${line}`, url: `/carrier/loads/${load.id}`, tag: `late-${load.id}-${stop}` }).catch(() => 0);
  }
  return done;
}

/** A short text to the driver, in their language, kept in their thread. Nothing when they opted out of texts. */
async function textDriver(ctx: CarrierContext, driver: Driver, english: string, log: { kind: string; loadId: string }, now: number) {
  if (!driver.phone || driver.prefs?.smsOptOut) return;
  const text = await translateForDriver(english, driver.prefs?.language ?? "en").catch(() => english);
  const sid = await textTo(ctx.carrier, driver.phone, text);
  await saveDriverMessage(ctx.carrier.id, { id: `dm-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, driverId: driver.id, from: "ai", content: text, timestamp: new Date(now).toISOString(), channel: "sms", ai: true }, "/driver/messages");
  await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: driver.phone, body: text, data: log });
}

/**
 * A rolling truck sitting still somewhere it shouldn't (lib/agent/late-risk): the driver gets a short "everything
 * OK?" text, once for each stop, and the owner sees it. A reply goes to the AI like any text.
 */
async function stoppedCheck(ctx: CarrierContext, load: Load, truck: Truck, driver: Driver | undefined, now: number): Promise<boolean> {
  const odd = stoppedOddly(load, truck, driver, now);
  if (!odd || !(await claimMark(ctx.carrier.id, load.id, `stopped:${truck.stoppedSince}`))) return false;
  const where = truck.position?.description ?? `${truck.currentCity}, ${truck.currentState}`;
  const hours = odd.minutes >= 120 ? `${Math.round(odd.minutes / 30) / 2} hours` : `${odd.minutes} minutes`;
  if (driver) await textDriver(ctx, driver, `Checking in: the truck's been stopped about ${hours} near ${where}. Everything OK? Reply if you need anything (a shop, parking, more time at the dock).`, { kind: "stopped_check", loadId: load.id }, now);
  await addActivity(ctx.carrier.id, event({ type: "check_call", loadId: load.id, message: `Truck ${truck.unitNumber} stopped ${hours} near ${where}`, detail: `${load.referenceNumber} · not at a stop, driver on duty. The AI texted ${driver?.name.split(" ")[0] ?? "the driver"} to check in.`, severity: "warning" }));
  return true;
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


/** The rate con asks for tracking or check calls (or the owner wants them on every load). */
export function wantsCheckCalls(load: Load, always: boolean | undefined): boolean {
  if (always) return true;
  const r = load.rateConReading;
  const text = [...(r?.otherConcerns ?? []), ...(r?.finesAndFees ?? []), r?.summary ?? ""].join(" ");
  return /track|check.?call|macropoint|trucker ?tools|fourkites|project44|update(s)? every/i.test(text);
}

/**
 * Check calls, the dispatcher's most repetitive job: while a load is rolling and the ELD knows where the truck is,
 * the broker gets a short location and ETA email every 4 hours (only for brokers who asked for tracking).
 */
export async function checkCalls(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  const slot = Math.floor(now / (4 * HOUR));
  for (const load of ctx.loads) {
    if (!["dispatched", "at_pickup", "in_transit", "at_delivery"].includes(load.stage) || !wantsCheckCalls(load, ctx.settings.checkCallEmails)) continue;
    const truck = ctx.trucks.find((t) => t.id === load.truckId);
    const pos = truck?.position;
    const to = load.brokerContactEmail ?? ctx.brokers.find((b) => b.id === load.brokerId)?.email;
    if (!truck || !pos || now - Date.parse(pos.at) > 30 * 60_000 || !to) continue;
    if (!(await claimMark(ctx.carrier.id, load.id, `check_call:${slot}`))) continue;
    const toPickup = load.stage === "dispatched";
    const [city, state] = toPickup ? [load.lane.origin, load.lane.originState] : [load.lane.destination, load.lane.destState];
    const drv = ctx.drivers.find((d) => d.id === truck.driverId);
    const ahead = truck.trip && load.tripId === truck.trip.id && truck.currentLoadId !== load.id ? tripEtas(ctx, truck, now)?.get(`${load.id}:${toPickup ? "pickup" : "delivery"}`) : undefined;
    const eta = ahead ?? (await routedEta(truck, drv, city, state, now)) ?? etaTo(truck, drv, city, state, now);
    const where = pos.description ?? `${truck.currentCity}, ${truck.currentState}`;
    const status = load.stage === "at_pickup" ? "At the shipper, loading" : load.stage === "at_delivery" ? "At the receiver, unloading" : toPickup ? `Heading to pickup in ${city}, ${state}` : `Loaded, heading to ${city}, ${state}`;
    await sendOrQueue(ctx, {
      purpose: "eta_update",
      to,
      subject: mail.subjectFor(load, "Check call"),
      body: mail.checkCall(ctx.carrier, ctx.settings, load, { status, where, at: formatAtStop(pos.at, cityState(pos.description)?.state ?? state), eta: eta && (load.stage === "dispatched" || load.stage === "in_transit") ? formatAtStop(new Date(eta).toISOString(), state) : null }),
      loadId: load.id,
      withinRules: true,
      why: `Send ${load.referenceNumber}'s check call (truck at ${where})?`,
    });
    done.push(`${load.referenceNumber}: check call`);
  }
  return done;
}
