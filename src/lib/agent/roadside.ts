import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, aiConfigured, claude } from "../ai/server";
import { SHOP_CAN_HELP, SHOPS_NEAR } from "../channels/phrases";
import { absoluteUrl } from "../channels/twilio";
import { callTo, canCall, canEmail, sandboxed, textTo } from "../channels/out";
import { throughPhoneTree, WANT, type CallReply } from "../channels/ivr";
import { forCarrier } from "./scope";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { placeCoords, roadMiles } from "../trip-geo";
import type { Driver, Load, MessageChannel, Roadside, RoadsideShop, Truck } from "../types";
import { addActivity, claimMark, logChannel, save, saveDriverMessage, threadWith, type CarrierContext } from "./db";
import { event, passToOwner as raise, uid } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";

/**
 * A breakdown, handled the way a good dispatcher does it in the first ten minutes: find repair help near where the
 * truck actually is (the ELD position, or what the driver said), text the driver the nearest open shops, phone the
 * first one to see if they can come, tell the broker the load is delayed, and put the repair bill in front of the
 * owner. What the AI doesn't do: agree to a price for the repair, or tell the driver whether it's safe to drive.
 *
 * Shops come from Google Places (GOOGLE_PLACES_API_KEY, Places API (New) Text Search).
 */

export const placesConfigured = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);
const PLACES = () => process.env.PLACES_API_BASE?.replace(/\/$/, "") ?? "https://places.googleapis.com";
const ROLLING = new Set<Load["stage"]>(["dispatched", "at_pickup", "in_transit", "at_delivery"]);

/** What to search for, from how the driver described it. */
export function helpFor(details: string): string {
  if (/\b(tire|tyre|flat|blow ?out|blew)\b/i.test(details)) return "semi truck tire repair";
  if (/\b(tow|wreck|won'?t (start|move)|can'?t (move|drive)|stuck|ditch)\b/i.test(details)) return "heavy duty towing";
  return "semi truck repair";
}

interface PlacesAnswer {
  places?: {
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    rating?: number;
    currentOpeningHours?: { openNow?: boolean };
    location?: { latitude?: number; longitude?: number };
  }[];
}

type Place = Omit<RoadsideShop, "phone"> & { phone?: string };

export async function findShops(what: string, near: { lat: number; lon: number } | null, whereText: string): Promise<RoadsideShop[]> {
  return (await searchPlaces(what, near, whereText)).filter((p): p is RoadsideShop => !!p.phone).slice(0, 3);
}

async function searchPlaces(what: string, near: { lat: number; lon: number } | null, whereText: string): Promise<Place[]> {
  const body = near
    ? { textQuery: what, maxResultCount: 8, locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50000 } } }
    : { textQuery: `${what} near ${whereText}`, maxResultCount: 8 };
  const res = await fetch(`${PLACES()}/v1/places:searchText`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.currentOpeningHours.openNow,places.location",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Places ${res.status}`);
  const data = (await res.json()) as PlacesAnswer;
  return (data.places ?? [])
    .filter((p) => p.displayName?.text)
    .map((p) => ({
      name: p.displayName!.text!,
      address: p.formattedAddress ?? "",
      phone: p.nationalPhoneNumber,
      rating: p.rating,
      openNow: p.currentOpeningHours?.openNow,
      miles: near && p.location?.latitude !== undefined && p.location.longitude !== undefined ? Math.round(roadMiles([near.lat, near.lon], [p.location.latitude, p.location.longitude])) : undefined,
    }))
    // Open now first, then nearest, then best rated.
    .sort((a, b) => Number(b.openNow === true) - Number(a.openNow === true) || (a.miles ?? 999) - (b.miles ?? 999) || (b.rating ?? 0) - (a.rating ?? 0));
}

/** What a driver can ask the AI to find near the truck, and what that is in a map search. */
export const NEARBY = {
  parking: "truck parking",
  truck_stop: "truck stop",
  fuel: "diesel truck stop",
  scale: "CAT scale",
  wash: "truck wash",
  repair: "semi truck repair",
  tires: "semi truck tire repair",
} as const;

/** The closest few of something a driver needs (parking, fuel, a scale...), for the AI to read out or text. */
export async function findNearby(ctx: CarrierContext, driver: Driver, kind: keyof typeof NEARBY, said: string | undefined): Promise<string> {
  if (!placesConfigured()) return "Can't search maps here. Tell the driver you can't look it up right now and suggest their truck stop app.";
  const truck = ctx.trucks.find((t) => t.id === driver.truckId || t.secondDriverId === driver.id);
  const where = truck ? whereIs(truck, said, Date.now()) : { near: null, text: said ?? "" };
  if (!where.text && !where.near) return "Ask the driver where they are (highway and exit, or town).";
  let found: Place[] = [];
  try {
    found = (await searchPlaces(NEARBY[kind], where.near, where.text)).slice(0, 3);
  } catch (e) {
    console.error("[nearby] search failed", e);
    return "The map search didn't answer. Say you couldn't look it up right now.";
  }
  if (!found.length) return `Nothing found near ${where.text}. Say so.`;
  return `Near ${where.text}: ${found.map((p) => [p.name, p.address, p.miles !== undefined ? `${p.miles} miles` : null, p.openNow === true ? "open now" : p.openNow === false ? "closed now" : null, p.phone].filter(Boolean).join(", ")).join("; ")}. Give the driver the closest one or two. Parking fills up at night: if it's late, say to call ahead where there's a phone.`;
}

/** Where the truck is: a fresh ELD position beats what the driver said, which beats the last known city. */
function whereIs(truck: Truck, said: string | undefined, now: number): { near: { lat: number; lon: number } | null; text: string } {
  const p = truck.position;
  if (p && Date.parse(p.at) > now - 2 * 3600_000) return { near: { lat: p.lat, lon: p.lon }, text: p.description ?? `${truck.currentCity}, ${truck.currentState}` };
  if (said?.trim()) return { near: null, text: said.trim() };
  const c = placeCoords(truck.currentCity, truck.currentState);
  return { near: c ? { lat: c[0], lon: c[1] } : null, text: `${truck.currentCity}, ${truck.currentState}` };
}

async function textDriver(ctx: CarrierContext, driver: Driver, text: string, kind: string) {
  const to = toE164(driver.phone);
  if (!to || driver.prefs?.smsOptOut) return;
  const sid = await textTo(ctx.carrier, to, text);
  await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms" });
  await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: text, data: { kind } });
}

async function saveRoadside(ctx: CarrierContext, truck: Truck, roadside: Roadside) {
  const next = { ...truck, roadside };
  await save("trucks", ctx.carrier.id, next as unknown as Item);
  ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? next : t));
  return next;
}

/** Phones shop number `i`; false when there's none left to call or calls can't go out. */
async function callShop(ctx: CarrierContext, truck: Truck, roadside: Roadside, i: number): Promise<boolean> {
  const shop = roadside.shops[i];
  const to = shop ? toE164(shop.phone) : null;
  const url = absoluteUrl(`/api/channels/voice/shop?carrier=${encodeURIComponent(ctx.carrier.id)}&truck=${encodeURIComponent(truck.id)}&shop=${i}`);
  if (!to || (!url && !sandboxed(ctx.carrier)) || !canCall(ctx.carrier)) return false;
  await saveRoadside(ctx, truck, { ...roadside, calling: i });
  const sid = await callTo(ctx.carrier, to, url, { kind: "shop_call", ref: `${truck.id}:${i}`, machineDetection: true });
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", providerId: sid ? `${sid}:dial` : null, counterparty: to, body: `Calling ${shop.name} about truck ${truck.unitNumber}'s breakdown`, data: { kind: "shop_call", truckId: truck.id } });
  return true;
}

/**
 * The driver reported a breakdown. Returns what to tell them. Runs once per truck per six hours (a second report of
 * the same breakdown just gets the list again from the driver's texts).
 */
export async function handleBreakdown(ctx: CarrierContext, driver: Driver, details: string, said: string | undefined, source: MessageChannel): Promise<string> {
  const now = Date.now();
  const truck = ctx.trucks.find((t) => t.driverId === driver.id || t.secondDriverId === driver.id);
  if (!truck) return "No truck on file for this driver.";
  if (!(await claimMark(ctx.carrier.id, `truck:${truck.id}`, `breakdown:${Math.floor(now / (6 * 3600_000))}`)))
    return "Already working on this breakdown: the shops are in the driver's texts. Tell them the owner is on it.";
  const load = ctx.loads.find((l) => l.id === truck.currentLoadId && ROLLING.has(l.stage));
  const where = whereIs(truck, said, now);
  const lang = driver.prefs?.language ?? "en";
  const done: string[] = [];

  let shops: RoadsideShop[] = [];
  if (placesConfigured()) {
    try {
      shops = await findShops(helpFor(details), where.near, where.text);
    } catch (e) {
      console.error("[roadside] shop search failed", e);
    }
  }
  let roadside: Roadside = { at: new Date(now).toISOString(), driverId: driver.id, loadId: load?.id, details, where: where.text, shops, calling: -1 };
  let current: Truck = await saveRoadside(ctx, truck, roadside);

  let calling: string | null = null;
  if (shops.length) {
    const first = await callShop(ctx, current, roadside, 0);
    if (first) {
      calling = shops[0].name;
      roadside = { ...roadside, calling: 0 };
      current = ctx.trucks.find((t) => t.id === truck.id)!;
    }
    const list = shops.map((s, i) => `${i + 1}. ${s.name}${s.miles !== undefined ? `, ${s.miles} mi` : ""}${s.openNow === false ? " (closed now)" : ""}: ${s.phone}`).join("\n");
    await textDriver(ctx, driver, SHOPS_NEAR[lang]({ list, calling }), "roadside_shops");
    done.push(`texted ${driver.name.split(" ")[0]} ${shops.length} shop${shops.length === 1 ? "" : "s"} near ${where.text}`);
    if (calling) done.push(`is calling ${calling}`);
  }

  // The broker hears before the appointment is missed.
  if (load && canEmail(ctx.carrier)) {
    const to = load.brokerContactEmail ?? ctx.brokers.find((b) => b.id === load.brokerId)?.email;
    if (to && (await claimMark(ctx.carrier.id, load.id, "breakdown_notice"))) {
      await sendOrQueue(ctx, {
        purpose: "eta_update",
        to,
        subject: mail.subjectFor(load, "Delay"),
        body: mail.breakdownNotice(ctx.carrier, ctx.settings, load, where.text),
        loadId: load.id,
        withinRules: true,
        why: `Tell the broker ${load.referenceNumber} is delayed by a breakdown?`,
      });
      done.push("told the broker the load is delayed");
    }
  }

  const noHelp = !shops.length;
  await raise(ctx, {
    reason: `${driver.name} (breakdown): truck ${truck.unitNumber} broke down near ${where.text}${load ? ` on ${load.referenceNumber}` : ""}: ${details}.${done.length ? ` The AI ${done.join(", ")}.` : ""}${noHelp ? " It couldn't look up repair shops: find one for the driver." : " The repair bill needs your OK before the shop starts."}`,
    loadId: load?.id,
    label: "Sorted",
    source,
    to: noHelp ? "decider" : "owner",
  });
  await addActivity(ctx.carrier.id, event({ type: "incident", loadId: load?.id, message: `Truck ${truck.unitNumber} broke down`, detail: `${where.text} · ${details}`, severity: "danger" }));
  return noHelp
    ? "Couldn't look up repair shops; the office is finding one and will call the driver. Tell them to stay safe: flashers on, triangles out."
    : `Texted the driver ${shops.length} repair shop${shops.length === 1 ? "" : "s"} near them${calling ? ` and calling ${calling} now` : ""}. The owner and the broker know. Tell them to stay safe: flashers on, triangles out.`;
}

// ─── The call to the shop ────────────────────────────────────────────────────

export function shopCallOpening(ctx: CarrierContext, truck: Truck, r: Roadside): string {
  return `Hi, this is the AI dispatcher for ${ctx.carrier.name}, a trucking company. This call is transcribed. We have a ${truck.equipmentType.toLowerCase()} semi broken down near ${r.where}: ${r.details}. Can you send someone out or take it in today, and about how soon?`;
}

export const SHOP_VOICEMAIL = (ctx: CarrierContext) => `Hi, this is the AI dispatcher for ${ctx.carrier.name}. We have a semi broken down near you. Our driver will call you directly. Thanks.`;

const ShopAnswer = z.object({
  canHelp: z.enum(["yes", "no", "unclear"]),
  eta: z.string().nullable().describe("How soon they said, in their words (e.g. 'about 90 minutes', 'tomorrow morning'), or null."),
});

async function readShopAnswer(said: string): Promise<z.infer<typeof ShopAnswer>> {
  if (!aiConfigured()) return { canHelp: "unclear", eta: null };
  try {
    const response = await claude().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 500,
      ...FALLBACK,
      output_config: { effort: "low", format: betaZodOutputFormat(ShopAnswer) },
      system: "You read what a truck repair shop said on the phone when asked if they can help a broken-down semi today. Only what they actually said.",
      messages: [{ role: "user", content: said }],
    });
    return response.parsed_output ?? { canHelp: "unclear", eta: null };
  } catch (e) {
    console.error("[roadside] couldn't read the shop's answer", e);
    return { canHelp: "unclear", eta: null };
  }
}

/** What the shop said. Returns the words to say back and whether the call is over. */
export async function shopCallTurn(ctx: CarrierContext, truck: Truck, said: string): Promise<{ reply: string; hangUp: boolean }> {
  const r = truck.roadside;
  if (!r) return { reply: "Sorry, wrong number. Thanks.", hangUp: true };
  const shop = r.shops[r.calling];
  const driver = ctx.drivers.find((d) => d.id === r.driverId);
  const answer = await readShopAnswer(said);
  if (answer.canHelp === "yes" && shop && driver) {
    await saveRoadside(ctx, truck, { ...r, found: { shop: shop.name, phone: shop.phone, eta: answer.eta } });
    await textDriver(ctx, driver, SHOP_CAN_HELP[driver.prefs?.language ?? "en"]({ shop: shop.name, phone: shop.phone, eta: answer.eta }), "roadside_found");
    await addActivity(ctx.carrier.id, event({ type: "incident", loadId: r.loadId, message: `${shop.name} can help truck ${truck.unitNumber}`, detail: `${answer.eta ?? "time not given"} · the driver has their number`, severity: "success" }));
    return { reply: `Thank you. Our driver, ${driver.name.split(" ")[0]}, will call you in a minute to set it up and give you the exact spot. The owner will approve the bill.`, hangUp: true };
  }
  if (answer.canHelp === "no") {
    const moved = await nextShop(ctx, truck);
    return { reply: moved ? "No problem, thanks for your time." : "Understood, thanks anyway.", hangUp: true };
  }
  return { reply: "Sorry, just to be sure: can you help us today, yes or no, and how soon?", hangUp: false };
}

/** The shop said no or didn't pick up: call the next one, or hand it to support when there's none left. */
export async function nextShop(ctx: CarrierContext, truck: Truck): Promise<boolean> {
  const r = truck.roadside;
  if (!r || r.found) return false;
  const i = r.calling + 1;
  if (i < r.shops.length && (await callShop(ctx, truck, r, i))) return true;
  await saveRoadside(ctx, truck, { ...r, exhausted: true });
  await raise(ctx, { reason: `None of the shops the AI called could help truck ${truck.unitNumber} near ${r.where}. Find a shop or tow for the driver.`, loadId: r.loadId, critical: true, label: "Sorted", source: "voice", to: "support" });
  return false;
}

/** One turn of a call with a repair shop, by either kind of call: logged and answered. */
export function shopCallReply(ctx: CarrierContext, truck: Truck, callSid: string, said: string): Promise<CallReply> {
  return forCarrier(ctx.carrier.id, () => shopCallAnswer(ctx, truck, callSid, said));
}

async function shopCallAnswer(ctx: CarrierContext, truck: Truck, callSid: string, said: string): Promise<CallReply> {
  const key = `shop:${callSid}`;
  // A shop's phone menu ("for road service, press 2") and hold, before anyone picks up.
  const earlier = await threadWith(ctx.carrier.id, "voice", key, 40);
  const tree = await throughPhoneTree(said, WANT.shop, earlier, (direction, body, extra) => logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction, counterparty: key, body, data: { kind: "shop_call", truckId: truck.id, ...extra } }));
  if (tree) {
    if (tree.hangUp) await nextShop(ctx, truck);
    return tree;
  }
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "in", counterparty: key, body: said, data: { kind: "shop_call", truckId: truck.id } });
  const result = await shopCallTurn(ctx, truck, said);
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", counterparty: key, body: result.reply, data: { kind: "shop_call", truckId: truck.id } });
  return result;
}
