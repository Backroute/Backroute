import "server-only";
import { hosNow, whereHoursEnd } from "../hos-clock";
import { cityCoords, distanceMiles, type LatLng } from "../trip-geo";
import type { ActivityEvent, Driver, Expense, Load, ParkingReservation, ParkingSpot, Truck } from "../types";
import { PRIMARY_CARRIER_ID } from "../mock-data";
import { zoneFor } from "../stop-time";
import { textTo } from "../channels/out";
import { addActivity, claimMark, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import type { Item } from "../cloud/rows";

/**
 * Reserving truck parking, only ever because the driver or the owner asked: from the button on the driver's screen,
 * or by asking the AI (text, call, the app's chat). The AI never books a spot on its own, and never offers to on
 * autopilot; a spot costs money and the driver may know a better place to stop.
 *
 * The parking service is set with PARKING_API_BASE and PARKING_API_KEY (a reservation network such as Truck Parking
 * Club, behind the small API below). Without it, the AI finds lots nearby (lib/agent/roadside) and the driver books.
 *
 *   GET  {base}/v1/spots?lat=&lon=&radius_mi=&arrive=   → { spots: [{ id, name, address, lat, lon, price }] }
 *   POST {base}/v1/reservations { spotId, arrive, driverName, driverPhone, unitNumber, company }
 *                                                       → { id, confirmation, checkIn? }
 *   POST {base}/v1/reservations/{id}/cancel             → { ok }
 */

export const parkingConfigured = () => Boolean(process.env.PARKING_API_BASE && process.env.PARKING_API_KEY);
const BASE = () => process.env.PARKING_API_BASE!.replace(/\/$/, "");
const headers = () => ({ "content-type": "application/json", authorization: `Bearer ${process.env.PARKING_API_KEY}` });
const ROLLING = new Set<Load["stage"]>(["dispatched", "at_pickup", "in_transit", "at_delivery"]);
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Whether the person really asked for it: the words the AI says they used must be in what they said. A guard against
 * the AI booking because it thought it would help; the asking itself is in any language.
 */
export function askedForIt(quoted: string | undefined, said: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  const q = norm(quoted ?? "");
  return q.length >= 2 && norm(said).includes(q);
}

/** Where the truck will be when the driver's hours run out (or where it is, when they make the stop or have no load). */
export function whereToPark(truck: Truck, driver: Driver | undefined, loads: Load[], now = Date.now()): { at: LatLng; arrive: number; note: string } | null {
  const pos: LatLng | null = truck.position && now - Date.parse(truck.position.at) < 3 * 3600_000 ? [truck.position.lat, truck.position.lon] : (cityCoords(truck.currentCity, truck.currentState) ?? null);
  if (!pos) return null;
  const load = loads.find((l) => l.id === truck.currentLoadId && ROLLING.has(l.stage));
  const hos = driver ? hosNow(driver, now) : null;
  const left = hos ? Math.max(0, Math.min(hos.drive, hos.shift)) : (driver?.hoursRemaining ?? 0);
  const goingTo = load ? (load.stage === "dispatched" || load.stage === "at_pickup" ? cityCoords(load.lane.origin, load.lane.originState) : cityCoords(load.lane.destination, load.lane.destState)) : undefined;
  if (!goingTo || left <= 0.25) return { at: pos, arrive: now + 30 * 60_000, note: "near the truck" };
  const end = whereHoursEnd(pos, goingTo, 0, left);
  if (end.reachesStop) return { at: goingTo, arrive: now + (distanceMiles(pos, goingTo) * 1.2 / 50) * 3600_000, note: `near the ${load!.stage === "dispatched" || load!.stage === "at_pickup" ? "pickup" : "delivery"}` };
  return { at: end.at, arrive: now + left * 3600_000, note: `where the hours run out, about ${end.miles} miles ahead` };
}

/** Reservable spots near a point, closest first. */
export async function parkingSpots(at: LatLng, arrive: number, radiusMiles = 40): Promise<ParkingSpot[]> {
  if (!parkingConfigured()) return [];
  const q = new URLSearchParams({ lat: at[0].toFixed(4), lon: at[1].toFixed(4), radius_mi: String(radiusMiles), arrive: new Date(arrive).toISOString() });
  const res = await fetch(`${BASE()}/v1/spots?${q}`, { headers: headers(), signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) throw new Error(`Parking ${res.status}`);
  const data = (await res.json()) as { spots?: ParkingSpot[] };
  return (data.spots ?? [])
    .filter((s) => s.id && s.name && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({ ...s, price: Number(s.price) || 0, miles: Math.round(distanceMiles(at, [s.lat, s.lon])) }))
    .sort((a, b) => (a.miles ?? 0) - (b.miles ?? 0))
    .slice(0, 5);
}

function event(p: Omit<ActivityEvent, "id" | "timestamp" | "carrierId">): ActivityEvent {
  return { id: uid("act"), timestamp: new Date().toISOString(), carrierId: PRIMARY_CARRIER_ID, ...p };
}

const timeAt = (ms: number, state: string) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zoneFor(state), timeZoneName: "short" });

/**
 * Book a spot the driver or owner picked (or asked the AI to take, the closest). Saved on the truck, logged for the
 * owner, and texted to the driver when they weren't the one who asked in the app.
 */
export async function reserveParking(ctx: CarrierContext, truck: Truck, spot: ParkingSpot, arrive: number, askedBy: "driver" | "owner", textDriver: boolean): Promise<ParkingReservation> {
  if (!parkingConfigured()) throw new Error("parking_off");
  const driver = ctx.drivers.find((d) => d.id === truck.driverId);
  const res = await fetch(`${BASE()}/v1/reservations`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ spotId: spot.id, arrive: new Date(arrive).toISOString(), driverName: driver?.name ?? "", driverPhone: driver?.phone ?? "", unitNumber: truck.unitNumber, company: ctx.carrier.name }),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Parking ${res.status}`);
  const got = (await res.json()) as { id?: string; confirmation?: string; checkIn?: string };
  if (!got.id) throw new Error("Parking: no reservation id");
  const reservation: ParkingReservation = {
    id: got.id,
    place: spot.name,
    address: spot.address,
    lat: spot.lat,
    lon: spot.lon,
    price: spot.price,
    arriveAt: new Date(arrive).toISOString(),
    confirmation: got.confirmation ?? got.id,
    ...(got.checkIn ? { checkIn: got.checkIn } : {}),
    askedBy,
    at: new Date().toISOString(),
    status: "booked",
  };
  const next = { ...truck, parking: reservation };
  await save("trucks", ctx.carrier.id, next as unknown as Item);
  Object.assign(truck, next);
  // The fee, as a cost the company paid: in the books (lib/agent/quickbooks), never reimbursed on the driver's pay.
  if (driver && spot.price > 0)
    await save("records", ctx.carrier.id, parkingExpense(reservation, driver.id, truck.currentLoadId ?? null, "approved") as unknown as Item, "expense");
  await addActivity(ctx.carrier.id, event({ type: "expense", message: `Parking reserved for ${truck.unitNumber}`, detail: `${spot.name}, ${spot.address} · $${spot.price} · ${askedBy === "owner" ? "you asked" : `${driver?.name.split(" ")[0] ?? "the driver"} asked`}`, severity: "success" }));
  if (textDriver && driver?.phone && !driver.prefs?.smsOptOut) {
    const text = parkingText(reservation, spot.address);
    const sid = await textTo(ctx.carrier, driver.phone, text);
    await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms", ai: true }, "/driver");
    await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: driver.phone, body: text, data: { kind: "parking" } });
  }
  return reservation;
}

/** What the driver gets: the place and street address (for the truck GPS), the confirmation, and how to check in. */
export function parkingText(r: ParkingReservation, address = r.address): string {
  return `Parking reserved: ${r.place}, ${address}. Confirmation ${r.confirmation}, $${r.price} for the night.${r.checkIn ? ` ${r.checkIn}` : ""} Say cancel parking if you'd rather not.`;
}

/** The parking fee as an expense record: company-paid (upfront), so it's a cost in the books and not on the driver's pay. */
function parkingExpense(r: ParkingReservation, driverId: string, loadId: string | null, status: Expense["status"]): Expense {
  return { id: `parking-${r.id}`, driverId, carrierId: PRIMARY_CARRIER_ID, loadId, category: "parking", amount: r.price, note: `Reserved: ${r.place}`, status, createdAt: r.at, respondedAt: new Date().toISOString(), upfront: true, facility: r.place };
}

/** `ai`: the AI cancelled it because the plan changed (the load was cancelled); never to book one. */
export async function cancelParking(ctx: CarrierContext, truck: Truck, by: "driver" | "owner" | "ai", why?: string): Promise<boolean> {
  const r = truck.parking;
  if (!r || r.status !== "booked" || !parkingConfigured()) return false;
  const res = await fetch(`${BASE()}/v1/reservations/${encodeURIComponent(r.id)}/cancel`, { method: "POST", headers: headers(), signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) throw new Error(`Parking ${res.status}`);
  const next = { ...truck, parking: { ...r, status: "cancelled" as const } };
  await save("trucks", ctx.carrier.id, next as unknown as Item);
  Object.assign(truck, next);
  // The fee comes back off the books.
  if (truck.driverId) await save("records", ctx.carrier.id, parkingExpense(r, truck.driverId, null, "denied") as unknown as Item, "expense");
  await addActivity(ctx.carrier.id, event({ type: "expense", message: `Parking cancelled for ${truck.unitNumber}`, detail: `${r.place} · ${by === "owner" ? "you asked" : by === "driver" ? "the driver asked" : (why ?? "the plan changed")}`, severity: "info" }));
  return true;
}

/**
 * Once, about an hour before the driver gets there: the spot's address and how to get in, so they don't have to dig
 * for it at the end of a long day.
 */
export async function parkingReminders(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const truck of ctx.trucks) {
    const r = truck.parking;
    if (!r || r.status !== "booked") continue;
    const until = Date.parse(r.arriveAt) - now;
    if (until > 75 * 60_000 || until < -30 * 60_000) continue;
    const driver = ctx.drivers.find((d) => d.id === truck.driverId);
    if (!driver?.phone || driver.prefs?.smsOptOut || !(await claimMark(ctx.carrier.id, `parking:${r.id}`, "reminder"))) continue;
    const text = `Your parking tonight: ${r.place}, ${r.address}. Confirmation ${r.confirmation}.${r.checkIn ? ` ${r.checkIn}` : ""}`;
    const sid = await textTo(ctx.carrier, driver.phone, text);
    await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date(now).toISOString(), channel: "sms", ai: true }, "/driver");
    await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: driver.phone, body: text, data: { kind: "parking_reminder" } });
    done.push(`Parking reminder to ${driver.name.split(" ")[0]}`);
  }
  return done;
}

/** For the AI: spots near where the truck will stop, as lines it can read out, with ids to book by. */
export async function spotsForAi(ctx: CarrierContext, truck: Truck): Promise<string> {
  if (!parkingConfigured()) return "Reserving parking isn't set up for this fleet. Find lots nearby with find_nearby (kind parking) instead, and say the driver can reserve in their truck stop app.";
  const driver = ctx.drivers.find((d) => d.id === truck.driverId);
  const where = whereToPark(truck, driver, ctx.loads);
  if (!where) return "No location for the truck yet. Ask where they want to stop (town or highway exit).";
  const spots = await parkingSpots(where.at, where.arrive).catch((e) => (console.error("[parking] search failed", e), null));
  if (spots === null) return "The parking service didn't answer. Say so, and find lots nearby with find_nearby instead.";
  if (!spots.length) return `No reservable spots ${where.note}. Find lots nearby with find_nearby instead.`;
  return `Reservable spots ${where.note} (arriving about ${timeAt(where.arrive, truck.currentState)}):\n${spots.map((s) => `${s.id}: ${s.name}, ${s.address}, ${s.miles} mi from there, $${s.price}`).join("\n")}`;
}

/** For the AI: book one of those spots (by id), once the person asked. */
export async function bookForAi(ctx: CarrierContext, truck: Truck, spotId: string | undefined, askedBy: "driver" | "owner", textDriver: boolean): Promise<string> {
  if (!parkingConfigured()) return "Reserving parking isn't set up for this fleet.";
  if (truck.parking?.status === "booked" && Date.parse(truck.parking.arriveAt) > Date.now() - 12 * 3600_000) return `There's already a spot booked: ${truck.parking.place} (confirmation ${truck.parking.confirmation}). Cancel it first if they want a different one.`;
  const driver = ctx.drivers.find((d) => d.id === truck.driverId);
  const where = whereToPark(truck, driver, ctx.loads);
  if (!where) return "No location for the truck yet. Ask where they want to stop.";
  const spots = await parkingSpots(where.at, where.arrive).catch(() => [] as ParkingSpot[]);
  const spot = spotId ? spots.find((s) => s.id === spotId) : spots[0];
  if (!spot) return "That spot isn't available any more. Look again with find_parking_spots.";
  try {
    const r = await reserveParking(ctx, truck, spot, where.arrive, askedBy, textDriver);
    return `Booked: ${r.place}, ${r.address}, confirmation ${r.confirmation}, $${r.price}.${r.checkIn ? ` ${r.checkIn}` : ""}${textDriver ? " The driver has it by text." : ""}`;
  } catch (e) {
    console.error("[parking] reserve failed", e);
    return "The parking service didn't take the booking. Say so; nothing was booked.";
  }
}
