import "server-only";
import { holdForBilling } from "../billing";
import { assessBroker } from "../broker-policy";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { estimateMiles, guessEquipment, makeBroker, makeLoad } from "../fleet";
import { NEW_LOAD, SLOW_DOCK } from "../channels/phrases";
import { absoluteUrl } from "../channels/twilio";
import { canCall, canText, textTo } from "../channels/out";
import { formatAtStop, stopLocalToIso } from "../stop-time";
import type { Broker, Load, Truck } from "../types";
import type { OfferReading } from "./broker-mail";
import { addActivity, claimMark, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { answerBrokerQuestion, event, passToOwner, tellOwner, uid } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import { checkBroker, untrustedBroker } from "./brokers";
import { checkCredit } from "./credit";
import { callBroker, truckAt } from "./broker-call";
import { canMakePickup } from "./eld";
import { askFor, floorFor } from "./pricing";
import { ourNumbers, respond, withTheirOffer } from "./negotiation";
import { brokerMemory, laneMemory } from "./memory";
import { route } from "./routing";
import { slowDocks } from "./facilities";
import { slowDocksAnywhere } from "./network";
import { carrierRecord, recordLine } from "./record";
import { lookalikeOf } from "./fraud";
import { marketRate } from "./rates";
import { homeTimeStatus } from "../home";
import * as mail from "./templates";
import { tipsForLoad } from "./facility-notes";
import { addWhy, whyBook, withWhy } from "./why";
import { hardProblem, scheduleWarnings } from "./schedule";
import { reeferLine } from "./reefer";
import { translateForDriver } from "../ai/translate";
import { cantRun } from "../expiry";
import { chainOf, doneAt, LINED_UP_MAX, reloadOutlook, reloadValue } from "./chain";
import { bestAssignment } from "./match";
import { learnedAsk } from "./ask-learning";

/**
 * Booking by email, the way a small carrier's dispatcher does it: loads brokers send in are matched to a truck that
 * can take them, the AI asks for a price inside the owner's rules, answers the broker's counter, and when the rate
 * con comes back and matches, puts the load on the truck and texts the driver.
 */

const HOUR = 3600_000;
const MAX_DEADHEAD = 300;

export interface Sender {
  /** The broker's email; empty for a load from a feed that gave only a phone number. */
  from: string;
  fromName: string;
  subject: string;
  messageId?: string;
  /** Set when the loads came from a load feed rather than an email: its name. */
  feed?: string;
}

/** The broker by their email, or a new one (the owner sees it on the Brokers page). */
export async function brokerFor(ctx: CarrierContext, email: string, name: string, companyName?: string | null): Promise<Broker> {
  const found = email
    ? ctx.brokers.find((b) => b.email?.toLowerCase() === email.toLowerCase())
    : ctx.brokers.find((b) => !!companyName && b.company.toLowerCase() === companyName.trim().toLowerCase());
  if (found) return found;
  const domain = email.split("@")[1]?.split(".").slice(-2, -1)[0];
  const company = companyName?.trim() || (domain && !/gmail|yahoo|outlook|hotmail|icloud|aol/i.test(domain) ? domain.toUpperCase() : name);
  let broker = makeBroker(company, email);
  // Writing from a domain one letter off a broker the carrier already knows: treated as an impostor until checked.
  const imitated = email ? lookalikeOf(email, ctx.brokers) : null;
  if (imitated) broker = { ...broker, authorityVerified: false, fraudRisk: "high", verifyNote: `Writes from ${email.split("@")[1]}, which looks like ${imitated.company}'s ${imitated.email?.split("@")[1]} but isn't. Could be someone posing as them.` };
  await save("records", ctx.carrier.id, broker as unknown as Item, "broker");
  ctx.brokers.push(broker);
  return broker;
}

/** Going for one of a truck's offers passes on the others (so the next free truck can have them). */
async function setAsideOthers(ctx: CarrierContext, chosen: Load, at: string) {
  ctx.loads = ctx.loads.map((l) => (l.id === chosen.id ? chosen : l.offerGroupId && l.offerGroupId === chosen.offerGroupId && l.stage === "offered" ? { ...l, stage: "declined" as const, updatedAt: at } : l));
  for (const l of ctx.loads) if (l.offerGroupId === chosen.offerGroupId && l.id !== chosen.id && l.stage === "declined" && l.updatedAt === at) await save("loads", ctx.carrier.id, l as unknown as Item);
}

/** A truck with nothing on it right now: no load it's hauling or heading to. */
function emptyNow(ctx: Pick<CarrierContext, "trucks" | "loads">, truckId: string | null): boolean {
  const truck = ctx.trucks.find((t) => t.id === truckId);
  return !!truck && truck.status === "available" && !ctx.loads.some((l) => l.truckId === truck.id && ["booked", "rate_confirmed", "dispatched", "at_pickup", "in_transit", "at_delivery"].includes(l.stage));
}

/**
 * The truck that can take a load soonest with the least empty driving, if any. A truck with loads lined up (up to
 * three, lib/agent/chain) takes one that picks up after the last of them delivers, from where that one ends.
 */
export function bestTruck(ctx: CarrierContext, o: LoadAsk, skip?: Set<string>, opts: { planned?: boolean } = {}) {
  let best: { truck: Truck; deadhead: number } | null = null;
  for (const truck of ctx.trucks) {
    if (skip?.has(truck.id)) continue;
    const deadhead = fitFor(ctx, truck, o, opts);
    if (deadhead === null) continue;
    if (!best || deadhead < best.deadhead) best = { truck, deadhead };
  }
  return best;
}

type LoadAsk = { equipment: Load["equipmentType"]; originCity: string; originState: string; destinationState: string; pickupAt: number | null; miles: number };
const askOf = (l: Load): LoadAsk => ({ equipment: l.equipmentType, originCity: l.lane.origin, originState: l.lane.originState, destinationState: l.lane.destState, pickupAt: l.pickupAt ? Date.parse(l.pickupAt) : null, miles: l.lane.miles });

/** Whether this truck can take the load, and the empty miles to it if so (null: it can't). */
function fitFor(ctx: CarrierContext, truck: Truck, o: LoadAsk, opts: { planned?: boolean } = {}): number | null {
  if (!truck.driverId || truck.equipmentType !== o.equipment || truck.status === "maintenance") return null;
  // Can't legally run: an inspection or plates past due, a critical engine fault, a driver whose CDL or medical card
  // ran out (lib/expiry). No load goes on it; the owner was reminded ahead of time.
  if (cantRun(truck, ctx.drivers.find((d) => d.id === truck.driverId), Date.now())) return null;
  // States the driver said they won't run into.
  if (ctx.drivers.find((d) => d.id === truck.driverId)?.prefs?.avoidStates?.includes(o.destinationState)) return null;
  const chain = chainOf(ctx.loads, truck);
  // Contract freight the shipper already agreed (planned) isn't held to the three the AI books ahead on its own.
  if (!opts.planned && chain.length >= LINED_UP_MAX) return null;
  const last = chain[chain.length - 1];
  let from = { city: truck.currentCity, state: truck.currentState };
  if (last) {
    // A truck with loads lined up can take one that picks up after the last delivers, with a couple of hours to spare.
    const free = doneAt(last);
    if (!free || !o.pickupAt || free + 2 * HOUR > o.pickupAt) return null;
    from = { city: last.lane.destination, state: last.lane.destState };
  }
  // A truck already chasing a load the AI asked for stays on that one.
  if (ctx.loads.some((l) => l.truckId === truck.id && l.stage === "negotiating")) return null;
  const deadhead = estimateMiles(from, { city: o.originCity, state: o.originState }) ?? 150;
  if (deadhead > (ctx.settings.maxDeadhead ?? MAX_DEADHEAD)) return null;
  // With an ELD connected: only a driver who has the hours to get there in time.
  if (!last && !canMakePickup(ctx.drivers.find((d) => d.id === truck.driverId), deadhead, o.miles, o.pickupAt, Date.now())) return null;
  return deadhead;
}

/**
 * What a load is worth on a given truck, the way pickForTruck weighs it: never one that makes the driver miss home
 * time; for a driver who needs to head home (or the owner said so), closest to home wins; otherwise the profit after
 * this truck's empty miles, less what reloading where it ends will likely cost. Null: not on this truck.
 */
function worthOn(ctx: CarrierContext, l: Load, truck: Truck, deadhead: number, now: Date): number | null {
  const net = (l.netProfit ?? 0) + Math.round((l.deadheadMiles - deadhead) * 0.68);
  const reload = reloadValue(reloadOutlook(ctx.loads, l.lane.destination, l.lane.destState, l.equipmentType, now.getTime()).outlook);
  const driver = ctx.drivers.find((d) => d.id === truck.driverId);
  if (!driver?.homeBase) return net + reload;
  const at = new Date(Math.max(now.getTime(), Date.parse(l.deliveryAt ?? l.pickupAt ?? "") || 0));
  const local = driver.runType === "local" || driver.runType === "intown";
  const d = local && at.toDateString() !== now.toDateString() ? { ...driver, hoursRemaining: 11 } : driver;
  const after = homeTimeStatus(d, l.lane.destination, l.lane.destState, at);
  if (after.state === "late") return null;
  const nowState = homeTimeStatus(driver, truck.currentCity, truck.currentState, now).state;
  if (driver.homePriority || nowState === "head_home" || nowState === "late") return 1_000_000 - (after.hoursHome ?? 999) * 1000 + net / 1000;
  return net + reload;
}

/**
 * The whole fleet at once: of the loads the AI may ask for on its own, which truck asks for which, for the best total
 * (lib/agent/match). A load moves to the truck that should take it; each truck asks for at most one.
 */
function matchFleet(ctx: CarrierContext, loads: Load[], now = new Date()): { load: Load; truck: Truck; deadhead: number }[] {
  const trucks = ctx.trucks.filter((t) => t.driverId && t.status !== "maintenance");
  const fits: (number | null)[][] = loads.map((l) => trucks.map((t) => fitFor(ctx, t, askOf(l))));
  const value = loads.map((l, i) => trucks.map((t, j) => (fits[i][j] === null ? null : worthOn(ctx, l, t, fits[i][j]!, now))));
  return bestAssignment(value).map(([i, j]) => ({ load: loads[i], truck: trucks[j], deadhead: fits[i][j]! }));
}

/**
 * Loads a broker emailed: each one that fits a truck becomes an offer on the owner's dashboard. On "Within my rules"
 * or full autopilot, the AI asks to book the best one for each truck if it pays at least the owner's lowest rate.
 */
export async function offersFromEmail(ctx: CarrierContext, offers: OfferReading[], sender: Sender, who: { company?: string | null; mc?: string | null; phone?: string | null; contact?: string | null } = {}, opts: { onCall?: boolean } = {}): Promise<{ added: Load[]; asked: Load[] }> {
  let broker = await brokerFor(ctx, sender.from, sender.fromName, who.company);
  if ((who.phone && !broker.phone) || (who.contact && !broker.contact)) {
    broker = { ...broker, phone: broker.phone || who.phone || "", contact: broker.contact || who.contact || "" };
    await save("records", ctx.carrier.id, broker as unknown as Item, "broker");
    ctx.brokers = ctx.brokers.map((b) => (b.id === broker.id ? broker : b));
  }
  if (!broker.authorityVerified || who.mc) broker = await checkBroker(ctx, broker, who.mc);
  const added: Load[] = [];
  for (const o of offers) {
    if (!o.originCity || !o.originState || !o.destinationCity || !o.destinationState) continue;
    const equipment = guessEquipment(o.equipment) ?? "Dry Van";
    if (o.loadNumber && ctx.loads.some((l) => l.brokerId === broker.id && l.referenceNumber.toLowerCase() === o.loadNumber!.toLowerCase())) continue;
    const pickupAt = stopLocalToIso(o.pickupLocal, o.originState);
    const deliveryAt = stopLocalToIso(o.deliveryLocal, o.destinationState);
    // The same load again (a feed read every round, a broker resending their list): once is enough.
    const same = (l: Load) => l.brokerId === broker.id && l.lane.origin.toLowerCase() === o.originCity!.toLowerCase() && l.lane.destination.toLowerCase() === o.destinationCity!.toLowerCase() && (l.pickupAt ?? null) === (pickupAt ?? null);
    if (!o.loadNumber && ctx.loads.some(same)) continue;
    if (pickupAt && Date.parse(pickupAt) < Date.now()) continue; // Already gone.
    // Truck routing (real road miles) when it's set up, the built-in estimate otherwise.
    const miles = o.miles ?? (await route({ city: o.originCity, state: o.originState }, { city: o.destinationCity, state: o.destinationState }))?.miles ?? estimateMiles({ city: o.originCity, state: o.originState }, { city: o.destinationCity, state: o.destinationState });
    if (!miles) continue;
    const fit = bestTruck(ctx, { equipment, originCity: o.originCity, originState: o.originState, destinationState: o.destinationState, pickupAt: pickupAt ? Date.parse(pickupAt) : null, miles });
    if (!fit) continue;

    const posted = o.rate ?? 0;
    const draft = { lane: { miles }, listedRate: posted } as Pick<Load, "lane" | "listedRate">;
    const market = await marketRate({ originCity: o.originCity, originState: o.originState, destinationCity: o.destinationCity, destinationState: o.destinationState, equipment });
    const learned = learnedAsk(ctx.loads, { brokerId: broker.id, brokerName: broker.company, lane: { originState: o.originState, destState: o.destinationState } }, Date.now());
    const ask = askFor(draft as Load, ctx.settings, laneMemory(ctx.loads, ctx.brokers, { originState: o.originState, destState: o.destinationState }), market, brokerMemory(ctx.loads, broker.id), learned);
    const base = makeLoad(
      {
        truckId: fit.truck.id,
        brokerId: broker.id,
        referenceNumber: o.loadNumber ?? "",
        originCity: o.originCity,
        originState: o.originState,
        destinationCity: o.destinationCity,
        destinationState: o.destinationState,
        miles,
        pickupWindow: o.pickup ?? (pickupAt ? formatAtStop(pickupAt, o.originState) : "Ask the broker"),
        deliveryWindow: o.delivery ?? (deliveryAt ? formatAtStop(deliveryAt, o.destinationState) : "Ask the broker"),
        pickupAt: pickupAt ?? undefined,
        deliveryAt: deliveryAt ?? undefined,
        rate: ask ?? (posted || 1),
        equipment,
        weight: o.weight ?? undefined,
      },
      broker,
      fit.truck,
      "offered",
      fit.deadhead,
    );
    const load: Load = {
      ...base,
      listedRate: posted,
      targetRate: ask ?? posted,
      bookedRate: null,
      isChained: false,
      offerGroupId: `offers-${fit.truck.id}`,
      source: sender.feed ? `${sender.feed} · ${broker.company}` : `Email from ${broker.company}`,
      ...(market ? { market: { rpm: market.rpm, high: market.high, source: market.source } } : {}),
      ...(sender.from ? { brokerContactEmail: sender.from } : {}),
      ...(sender.feed ? {} : { offerEmail: { subject: sender.subject, messageId: sender.messageId } }),
    };
    // A holiday, a dock that's closed then, or too little time to drive it: noted on the offer; a hard one keeps the
    // AI from asking for it on its own.
    const warnings = await scheduleWarnings(load, fit.truck, ctx.carrier.id, ctx.drivers.find((d) => d.id === fit.truck.driverId)).catch(() => []);
    if (warnings.length) load.scheduleWarnings = warnings;
    await save("loads", ctx.carrier.id, load as unknown as Item);
    ctx.loads.unshift(load);
    added.push(load);
  }
  if (added.length)
    await addActivity(
      ctx.carrier.id,
      event({ type: "load_offered", message: `${added.length} load${added.length === 1 ? "" : "s"} from ${broker.company} fit your trucks`, detail: added.map((l) => `${l.lane.origin} → ${l.lane.destination}`).join(" · "), severity: "info" }),
    );

  // Within the rules, the AI asks for the best one per truck on its own (unless the broker is on the phone already).
  const asked: Load[] = [];
  if (opts.onCall) return { added, asked };
  // A board poster with a phone and no MC yet: the AI calls, asks for the MC and checks it before agreeing to book.
  const checkOnCall = !broker.mc && !!broker.phone && !broker.email && !!sender.feed;
  const trusted = assessBroker(broker, ctx.settings.brokerOverrides).policy !== "block" || checkOnCall;
  if (ctx.settings.autonomy !== "ask" && added.length && !trusted) await untrustedBroker(ctx, broker, added[0].id);
  if (ctx.settings.autonomy !== "ask" && trusted) {
    const floor = (l: Load) => floorFor(l, ctx.settings);
    const fair = added.filter((l) => floor(l) !== null && l.targetRate >= floor(l)! && !hardProblem(l));
    for (const { load, truck, deadhead } of matchFleet(ctx, fair)) {
      let pick = ctx.loads.find((x) => x.id === load.id) ?? load;
      if (pick.truckId !== truck.id) {
        // The fleet's best pairing puts it on another truck than its nearest one.
        pick = { ...pick, truckId: truck.id, offerGroupId: `offers-${truck.id}`, deadheadMiles: deadhead, updatedAt: new Date().toISOString() };
        await save("loads", ctx.carrier.id, pick as unknown as Item);
        ctx.loads = ctx.loads.map((x) => (x.id === pick.id ? pick : x));
      }
      await requestBooking(ctx, pick, pick.targetRate, { byRules: true, callFirst: !!sender.feed && emptyNow(ctx, pick.truckId) });
      asked.push(pick);
    }
  }
  return { added, asked };
}

/**
 * Which of a truck's offers the AI goes for, the way a dispatcher weighs it: a load that would make the driver miss
 * their home time is out; when the driver needs to head home (or the owner said to get them home first), the one
 * that ends closest to home; otherwise the one that makes the most.
 */
export function pickForTruck(ctx: Pick<CarrierContext, "trucks" | "drivers"> & { loads?: Load[] }, loads: Load[], now = new Date()): Load | undefined {
  if (!loads.length) return undefined;
  const allLoads = ctx.loads;
  const truck = ctx.trucks.find((t) => t.id === loads[0].truckId);
  const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
  if (!truck || !driver?.homeBase) {
    const worth = (l: Load) => (l.netProfit ?? 0) + reloadValue(reloadOutlook(allLoads ?? loads, l.lane.destination, l.lane.destState, l.equipmentType, now.getTime()).outlook);
    return [...loads].sort((a, b) => worth(b) - worth(a))[0];
  }
  // Judged when the load is done (a load for Sunday is checked against next week's home day, not today's clock).
  const after = (l: Load) => {
    const at = new Date(Math.max(now.getTime(), Date.parse(l.deliveryAt ?? l.pickupAt ?? "") || 0));
    const local = driver.runType === "local" || driver.runType === "intown";
    const d = local && at.toDateString() !== now.toDateString() ? { ...driver, hoursRemaining: 11 } : driver;
    return homeTimeStatus(d, l.lane.destination, l.lane.destState, at);
  };
  const ok = loads.filter((l) => after(l).state !== "late");
  const nowState = homeTimeStatus(driver, truck.currentCity, truck.currentState, now).state;
  if (driver.homePriority || nowState === "head_home" || nowState === "late")
    return ok.sort((a, b) => (after(a).hoursHome ?? 999) - (after(b).hoursHome ?? 999) || (b.netProfit ?? 0) - (a.netProfit ?? 0))[0];
  // Thinking a load ahead: the profit, less what it'll likely take to reload where it ends (lib/agent/chain).
  const worth = (l: Load) => (l.netProfit ?? 0) + reloadValue(reloadOutlook(allLoads ?? loads, l.lane.destination, l.lane.destState, l.equipmentType, now.getTime()).outlook);
  return ok.sort((a, b) => worth(b) - worth(a))[0];
}

/**
 * Ask the broker to book a load at a price: from the owner's tap (they chose it) or from the rules. The others offered
 * to that truck are set aside, the way picking one load passes on the rest.
 */
export async function requestBooking(ctx: CarrierContext, load: Load, ask: number, how: { byRules?: boolean; byOwner?: boolean; callFirst?: boolean }) {
  // An account whose trial ended unpaid (with billing required) books nothing new; what's booked keeps running.
  if (await holdForBilling(ctx, load.id)) return "queued" as const;
  let broker = ctx.brokers.find((b) => b.id === load.brokerId);
  // Their credit, before asking: too weak and the AI doesn't book on its own; slow to pay and it asks a bit more.
  if (broker && !how.byOwner) {
    const credit = await checkCredit(ctx, broker);
    broker = credit.broker;
    if (credit.blocked) {
      if (await claimMark(ctx.carrier.id, load.id, "credit_hold"))
        await tellOwner(ctx, { reason: `The AI didn't ask to book ${load.referenceNumber}: ${credit.why}. Brokers like that pay late or not at all. Book it yourself from the load if you still want it.`, loadId: load.id, label: "Got it", source: "email", brokerId: broker.id, severity: "warning" });
      return "queued" as const;
    }
    if (credit.surchargePct && !load.surchargePct) {
      ask = Math.round((ask * (1 + credit.surchargePct / 100)) / 25) * 25;
      load = { ...load, surchargePct: credit.surchargePct };
    }
  }
  // Why this load, at this price, for this truck: kept on the load, and shown with anything waiting for the owner.
  load = withWhy(load, whyBook(ctx, load, ask));
  const to = load.brokerContactEmail ?? broker?.email;
  // A truck sitting empty and a board load with a phone number: call now, the way dispatchers cover a load before
  // someone else does. The email is the fallback when the call can't go.
  if (how.callFirst && to && broker?.phone && canCall(ctx.carrier)) {
    const floor = floorFor(load, ctx.settings);
    if (how.byOwner || (floor !== null && ask >= floor && ctx.settings.autonomy !== "ask")) {
      const at = new Date().toISOString();
      const asking: Load = { ...load, stage: "negotiating", targetRate: ask, updatedAt: at, bookRequest: { ask, askedAt: at, status: "sent", ...(how.byOwner ? { byOwner: true } : {}) } };
      await save("loads", ctx.carrier.id, asking as unknown as Item);
      await setAsideOthers(ctx, asking, at);
      const url = absoluteUrl(`/api/channels/voice/broker?carrier=${encodeURIComponent(ctx.carrier.id)}&load=${encodeURIComponent(load.id)}`);
      if (await callBroker(ctx, asking, url)) return "sent" as const;
      load = asking;
    }
  }
  if (!to) {
    // A broker who only works by phone: the AI calls them. With no phone either, support finds a way to reach them.
    const floor = floorFor(load, ctx.settings);
    const allowed = how.byOwner || (floor !== null && ask >= floor && ctx.settings.autonomy !== "ask");
    const asking: Load = { ...load, stage: "negotiating", targetRate: ask, updatedAt: new Date().toISOString(), bookRequest: { ask, askedAt: new Date().toISOString(), status: "sent", ...(how.byOwner ? { byOwner: true } : {}) } };
    if (allowed && broker?.phone) {
      await save("loads", ctx.carrier.id, asking as unknown as Item);
      ctx.loads = ctx.loads.map((l) => (l.id === load.id ? asking : l));
      const url = absoluteUrl(`/api/channels/voice/broker?carrier=${encodeURIComponent(ctx.carrier.id)}&load=${encodeURIComponent(load.id)}`);
      if (await callBroker(ctx, asking, url)) return "sent" as const;
    }
    // No way to reach them: the owner asked for this one, so it's theirs to reach; otherwise the AI lets it go and
    // the truck stays free for the next load.
    if (how.byOwner) {
      await passToOwner(ctx, { reason: `No email for ${broker?.company ?? "the broker"} on ${load.referenceNumber}${broker?.phone ? " and the AI couldn't get through by phone" : " and no phone"}. Reach them to book it at $${ask.toLocaleString()}.`, loadId: load.id, label: "Reached them", source: "email", to: "owner" });
      return "queued" as const;
    }
    const gone: Load = { ...load, stage: "declined", updatedAt: new Date().toISOString() };
    await save("loads", ctx.carrier.id, gone as unknown as Item);
    ctx.loads = ctx.loads.map((l) => (l.id === load.id ? gone : l));
    await tellOwner(ctx, { reason: `Let ${load.referenceNumber} from ${broker?.company ?? "a broker"} go: no email${broker?.phone ? " and no answer by phone" : " or phone"} to book it with.`, loadId: load.id, source: "email" });
    return "queued" as const;
  }
  const at = new Date().toISOString();
  const updated: Load = { ...load, stage: "negotiating", targetRate: ask, updatedAt: at, bookRequest: { ask, askedAt: at, status: "drafted", ...(how.byOwner ? { byOwner: true } : {}) } };
  await save("loads", ctx.carrier.id, updated as unknown as Item);
  await setAsideOthers(ctx, updated, at);

  const floor = floorFor(load, ctx.settings);
  const subject = load.offerEmail ? (/^re:/i.test(load.offerEmail.subject) ? load.offerEmail.subject : `Re: ${load.offerEmail.subject}`) : mail.subjectFor(load);
  return sendOrQueue(ctx, {
    purpose: "book_request",
    to,
    toName: broker?.contact || undefined,
    subject: subject.includes(load.referenceNumber) ? subject : `${subject} (${load.referenceNumber})`,
    body: mail.bookRequest(ctx.carrier, ctx.settings, load, ask, broker?.contact || undefined, truckAt(ctx, load) ?? undefined, recordLine(carrierRecord(ctx.loads))),
    inReplyTo: load.offerEmail?.messageId,
    loadId: load.id,
    amount: ask,
    withinRules: floor !== null && ask >= floor,
    ownerAsked: !!how.byOwner,
    why: `Ask ${broker?.company ?? "the broker"} to book ${load.lane.origin} → ${load.lane.destination} at $${ask.toLocaleString()}? ${(load.why?.lines ?? []).slice(0, 3).join(" ")}`.trim(),
  });
}

/**
 * The broker answered our price. The haggling rules (lib/agent/negotiation) pick the answer; the email is a template
 * with exactly that number and a reason for it.
 */
export async function answerRateReply(ctx: CarrierContext, load: Load, reply: { brokerRate: number | null; agreed: boolean; contactName: string | null; question?: string | null }, sender: Sender) {
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const at = new Date().toISOString();
  if (load.stage === "declined") {
    // We'd passed on it and they came back. Only worth hearing while the truck is still free.
    const truck = ctx.trucks.find((t) => t.id === load.truckId);
    const busy = !truck || truck.status !== "available" || ctx.loads.some((l) => l.id !== load.id && l.truckId === truck.id && ["negotiating", "booked", "rate_confirmed", "dispatched"].includes(l.stage));
    if (busy || !load.bookRequest?.passedAt) return false;
    load = { ...load, stage: "negotiating", bookRequest: { ...load.bookRequest, status: "sent" } };
  }
  const ours = load.bookRequest?.ask ?? load.targetRate;
  const subject = /^re:/i.test(sender.subject) ? sender.subject : `Re: ${sender.subject}`;
  const name = reply.contactName ?? undefined;
  // Anything else they asked (where's the truck, when can it get there) is answered in the same email.
  const answer = reply.question ? await answerBrokerQuestion(ctx, load, reply.question) : null;
  if (reply.agreed && (!reply.brokerRate || ourNumbers(load.bookRequest, ours).includes(reply.brokerRate) || reply.brokerRate >= ours)) {
    const amount = reply.brokerRate ?? ours;
    const updated: Load = { ...load, updatedAt: at, targetRate: amount, bookRequest: { ...load.bookRequest!, ask: amount, status: "accepted", brokerOffer: amount } };
    await save("loads", ctx.carrier.id, updated as unknown as Item);
    ctx.loads = ctx.loads.map((l) => (l.id === load.id ? updated : l));
    await addActivity(ctx.carrier.id, event({ type: "negotiation_email", loadId: load.id, message: `${broker?.company ?? "Broker"} agreed to $${amount.toLocaleString()}`, detail: `${load.referenceNumber} · waiting on their rate con`, severity: "success" }));
    // A dispatcher answers a yes: thanks, the terms, and send the rate con.
    const body = mail.agreed(ctx.carrier, ctx.settings, updated, amount, name);
    await sendOrQueue(ctx, { purpose: "ack", to: sender.from, toName: name, subject, body: answer ? body.replace("\n\nSend the rate con here", `\n\n${answer}\n\nSend the rate con here`) : body, inReplyTo: sender.messageId, loadId: load.id, withinRules: true, why: `${broker?.company ?? "The broker"} agreed to $${amount.toLocaleString()} on ${load.referenceNumber}. Thank them and ask for the rate con?` });
    return;
  }
  if (!reply.brokerRate) return false; // Nothing to decide on: the AI's own reply handles it.
  const offer = reply.brokerRate;
  const move = respond(offer, load, ctx.settings, Date.now(), load.brokerId ? brokerMemory(ctx.loads, load.brokerId) : null);
  if (move.action === "pass" && load.bookRequest?.passedAt) return false; // Already passed; nothing more to say.
  const said = `Broker offered $${offer.toLocaleString()}: ${move.action === "accept" ? `within your numbers, so the AI took it at $${move.amount.toLocaleString()}.` : move.action === "counter" ? `the AI countered at $${move.amount.toLocaleString()}${move.final ? " (its last number)" : ""}. ${move.reason}` : move.why}`;
  const withOffer: Load = addWhy({ ...load, updatedAt: at, bookRequest: withTheirOffer(load.bookRequest, ours, offer, "email") }, said.trim());
  await save("loads", ctx.carrier.id, withOffer as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? withOffer : l));
  const company = broker?.company ?? "The broker";
  const base = { to: sender.from, toName: name, subject, inReplyTo: sender.messageId, loadId: load.id };
  if (move.action === "owner") {
    // Just under the owner's lowest: they decide. The acceptance is ready to send if they want it.
    await sendOrQueue(ctx, { ...base, purpose: "accept", body: mail.accept(ctx.carrier, ctx.settings, withOffer, offer, name, answer ?? undefined), amount: offer, withinRules: false, why: `${company} offered $${offer.toLocaleString()} on ${load.referenceNumber}. ${move.why} Send this to take it, or don't send to pass.` });
    return true;
  }
  if (move.action === "pass") {
    await sendOrQueue(ctx, { ...base, purpose: "pass", body: mail.pass(ctx.carrier, ctx.settings, withOffer, move.amount, offer, name), amount: move.amount, withinRules: true, why: `${move.why} Pass on it, leaving the door open at $${move.amount.toLocaleString()}?` });
    await addActivity(ctx.carrier.id, event({ type: "negotiation_email", loadId: load.id, message: `Walking away from ${company}'s $${offer.toLocaleString()}`, detail: `${load.referenceNumber} · our lowest is $${move.amount.toLocaleString()}`, severity: "info" }));
    return true;
  }
  const body =
    move.action === "accept"
      ? mail.accept(ctx.carrier, ctx.settings, withOffer, move.amount, name, answer ?? undefined)
      : mail.counter(ctx.carrier, ctx.settings, withOffer, move.amount, name, { final: move.final, held: move.held, split: move.split, reason: move.reason, answer: answer ?? undefined });
  await sendOrQueue(ctx, {
    ...base,
    purpose: move.action,
    body,
    amount: move.amount,
    withinRules: true,
    why:
      move.action === "accept"
        ? `${company} offered $${offer.toLocaleString()} on ${load.referenceNumber}, within your numbers. Accept it?`
        : `${company} offered $${offer.toLocaleString()} on ${load.referenceNumber}. Counter at $${move.amount.toLocaleString()}${move.final ? " (our last number)" : ""}?`,
  });
  return true;
}

/**
 * The broker confirmed (their rate con matched, or the owner says so): the load goes on its truck, now or next, and
 * the driver gets the text.
 */
export async function bookIt(ctx: CarrierContext, load: Load, rate?: number): Promise<{ load: Load; truck?: Truck }> {
  const truck = ctx.trucks.find((t) => t.id === load.truckId);
  const at = new Date().toISOString();
  const agreed = rate ?? load.rateConReading?.totalRate ?? load.bookRequest?.brokerOffer ?? load.bookRequest?.ask ?? load.targetRate;
  const free = truck && !truck.currentLoadId;
  // The rate con names the docks: their hours (from drivers' notes) and the holidays are checked again.
  const warnings = await scheduleWarnings(load, truck, ctx.carrier.id, ctx.drivers.find((d) => d.id === truck?.driverId)).catch(() => load.scheduleWarnings ?? []);
  const newlyHard = warnings.filter((w) => w.hard && !(load.scheduleWarnings ?? []).some((x) => x.text === w.text));
  const booked: Load = {
    ...load,
    ...(warnings.length ? { scheduleWarnings: warnings } : {}),
    stage: free ? "dispatched" : "booked",
    bookedRate: agreed,
    targetRate: agreed,
    isChained: !free,
    progressPct: free ? 5 : 0,
    updatedAt: at,
    bookRequest: load.bookRequest ? { ...load.bookRequest, status: "accepted" } : undefined,
  };
  await save("loads", ctx.carrier.id, booked as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? booked : l));
  let truckAfter: Truck | undefined;
  if (truck) {
    // On a load: this one is next, unless one is already next (then it waits behind it in the lineup, lib/agent/chain).
    truckAfter = free ? { ...truck, currentLoadId: load.id, status: "on_load" } : truck.nextLoadId ? truck : { ...truck, nextLoadId: load.id };
    if (truckAfter.currentLoadId !== truck.currentLoadId || truckAfter.nextLoadId !== truck.nextLoadId || truckAfter.status !== truck.status) {
      await save("trucks", ctx.carrier.id, truckAfter as unknown as Item);
      ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? truckAfter! : t));
    }
  }
  await addActivity(ctx.carrier.id, event({ type: "booked", loadId: load.id, message: `Booked: ${load.lane.origin} → ${load.lane.destination}`, detail: `${truck?.unitNumber ?? ""} · $${agreed.toLocaleString()}`, severity: "success" }));
  if (newlyHard.length) await passToOwner(ctx, { reason: `Heads-up on ${load.referenceNumber}: ${newlyHard.map((w) => w.text).join(" ")}`, loadId: load.id, label: "Checked", source: "email", to: "owner" });
  await textNewLoad(ctx, booked).catch((e) => console.error("[booking] new-load text failed", e));
  return { load: booked, truck: truckAfter };
}

/** The driver's text about a new load, in their language. False when it couldn't go (no texting, no number, STOP). */
export async function textNewLoad(ctx: CarrierContext, load: Load): Promise<boolean> {
  if (!canText(ctx.carrier)) return false;
  const truck = ctx.trucks.find((t) => t.id === load.truckId);
  const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
  const to = driver ? toE164(driver.phone) : null;
  if (!driver || !to || driver.prefs?.smsOptOut) return false;
  const lang = driver.prefs?.language ?? "en";
  // A dock that usually keeps trucks 3 hours or more: the driver hears it with the load.
  // The shared record from every carrier on Backroute fills in docks this carrier hasn't been to.
  const slow = (await slowDocksAnywhere(ctx, load).catch(() => slowDocks(ctx.loads, load))).map((f) => SLOW_DOCK[lang]({ name: f.name, hours: (Math.round(f.avgMinutes / 30) / 2).toString() }));
  // What the driver should know before they go: the reefer setting, and what other drivers said about the docks.
  const extra = [reeferLine(load), ...(await tipsForLoad(load).catch(() => [])), ...(load.scheduleWarnings ?? []).filter((w) => !w.hard).map((w) => w.text)].filter(Boolean).join(" ");
  const text = [NEW_LOAD[lang]({
    ref: load.referenceNumber,
    from: `${load.lane.origin}, ${load.lane.originState}`,
    to: `${load.lane.destination}, ${load.lane.destState}`,
    // The dock's street address with the time, when known: what the driver types into the truck GPS.
    pickup: load.pickupAddress ? `${load.pickupWindow} (${load.pickupAddress})` : load.pickupWindow,
    delivery: load.deliveryAddress ? `${load.deliveryWindow} (${load.deliveryAddress})` : load.deliveryWindow,
  }), ...slow, ...(extra ? [await translateForDriver(extra, lang)] : [])].join(" ");
  const sid = await textTo(ctx.carrier, to, text);
  await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms" }, "/driver");
  await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: text, data: { kind: "new_load", loadId: load.id } });
  return true;
}

