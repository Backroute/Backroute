import "server-only";
import { assessBroker } from "../broker-policy";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { estimateMiles, guessEquipment, makeBroker, makeLoad } from "../fleet";
import { NEW_LOAD } from "../channels/phrases";
import { absoluteUrl, sendSms, twilioConfigured } from "../channels/twilio";
import { formatAtStop, stopLocalToIso } from "../stop-time";
import type { Broker, Load, Truck } from "../types";
import type { OfferReading } from "./broker-mail";
import { addActivity, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { event, passToOwner, uid } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import { askSupportAboutBroker, checkBroker } from "./brokers";
import { callBroker } from "./broker-call";
import { canMakePickup } from "./eld";
import { answerBroker, askFor, floorFor } from "./pricing";
import * as mail from "./templates";

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
  const broker = makeBroker(company, email);
  await save("records", ctx.carrier.id, broker as unknown as Item, "broker");
  ctx.brokers.push(broker);
  return broker;
}

/** The truck that can take a load soonest with the least empty driving, if any. */
function bestTruck(ctx: CarrierContext, o: { equipment: Load["equipmentType"]; originCity: string; originState: string; pickupAt: number | null; miles: number }) {
  let best: { truck: Truck; deadhead: number } | null = null;
  for (const truck of ctx.trucks) {
    if (!truck.driverId || truck.equipmentType !== o.equipment || truck.status === "maintenance" || truck.nextLoadId) continue;
    const busy = ctx.loads.find((l) => l.id === truck.currentLoadId && !["delivered", "cancelled", "declined"].includes(l.stage));
    let from = { city: truck.currentCity, state: truck.currentState };
    if (busy) {
      // A truck on a load can take one that picks up after it delivers, with a couple of hours to spare.
      if (!busy.deliveryAt || !o.pickupAt || Date.parse(busy.deliveryAt) + 2 * HOUR > o.pickupAt) continue;
      from = { city: busy.lane.destination, state: busy.lane.destState };
    }
    // A truck already chasing a load the AI asked for stays on that one.
    if (ctx.loads.some((l) => l.truckId === truck.id && l.stage === "negotiating")) continue;
    const deadhead = estimateMiles(from, { city: o.originCity, state: o.originState }) ?? 150;
    if (deadhead > MAX_DEADHEAD) continue;
    // With an ELD connected: only a driver who has the hours to get there in time.
    if (!busy && !canMakePickup(ctx.drivers.find((d) => d.id === truck.driverId), deadhead, o.miles, o.pickupAt, Date.now())) continue;
    if (!best || deadhead < best.deadhead) best = { truck, deadhead };
  }
  return best;
}

/**
 * Loads a broker emailed: each one that fits a truck becomes an offer on the owner's dashboard. On "Within my rules"
 * or full autopilot, the AI asks to book the best one for each truck if it pays at least the owner's lowest rate.
 */
export async function offersFromEmail(ctx: CarrierContext, offers: OfferReading[], sender: Sender, who: { company?: string | null; mc?: string | null; phone?: string | null; contact?: string | null } = {}): Promise<{ added: Load[]; asked: Load[] }> {
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
    const miles = o.miles ?? estimateMiles({ city: o.originCity, state: o.originState }, { city: o.destinationCity, state: o.destinationState });
    if (!miles) continue;
    const fit = bestTruck(ctx, { equipment, originCity: o.originCity, originState: o.originState, pickupAt: pickupAt ? Date.parse(pickupAt) : null, miles });
    if (!fit) continue;

    const posted = o.rate ?? 0;
    const draft = { lane: { miles }, listedRate: posted } as Pick<Load, "lane" | "listedRate">;
    const ask = askFor(draft as Load, ctx.settings);
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
      ...(sender.from ? { brokerContactEmail: sender.from } : {}),
      ...(sender.feed ? {} : { offerEmail: { subject: sender.subject, messageId: sender.messageId } }),
    };
    await save("loads", ctx.carrier.id, load as unknown as Item);
    ctx.loads.unshift(load);
    added.push(load);
  }
  if (added.length)
    await addActivity(
      ctx.carrier.id,
      event({ type: "load_offered", message: `${added.length} load${added.length === 1 ? "" : "s"} from ${broker.company} fit your trucks`, detail: added.map((l) => `${l.lane.origin} → ${l.lane.destination}`).join(" · "), severity: "info" }),
    );

  // Within the rules, the AI asks for the best one per truck on its own.
  const asked: Load[] = [];
  const trusted = assessBroker(broker, ctx.settings.brokerOverrides).policy !== "block";
  if (ctx.settings.autonomy !== "ask" && added.length && !trusted) await askSupportAboutBroker(ctx, broker, added[0].id);
  if (ctx.settings.autonomy !== "ask" && trusted) {
    const byTruck = new Map<string, Load[]>();
    for (const l of added) byTruck.set(l.truckId!, [...(byTruck.get(l.truckId!) ?? []), l]);
    for (const group of byTruck.values()) {
      const floor = (l: Load) => floorFor(l, ctx.settings);
      const pick = group.filter((l) => floor(l) !== null && l.targetRate >= floor(l)!).sort((a, b) => (b.netProfit ?? 0) - (a.netProfit ?? 0))[0];
      if (pick) {
        await requestBooking(ctx, pick, pick.targetRate, { byRules: true });
        asked.push(pick);
      }
    }
  }
  return { added, asked };
}

/**
 * Ask the broker to book a load at a price: from the owner's tap (they chose it) or from the rules. The others offered
 * to that truck are set aside, the way picking one load passes on the rest.
 */
export async function requestBooking(ctx: CarrierContext, load: Load, ask: number, how: { byRules?: boolean; byOwner?: boolean }) {
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const to = load.brokerContactEmail ?? broker?.email;
  if (!to) {
    // A broker who only works by phone: the AI calls them. With no phone either, support finds a way to reach them.
    const floor = floorFor(load, ctx.settings);
    const allowed = how.byOwner || (floor !== null && ask >= floor && ctx.settings.autonomy !== "ask");
    const asking: Load = { ...load, stage: "negotiating", targetRate: ask, updatedAt: new Date().toISOString(), bookRequest: { ask, askedAt: new Date().toISOString(), status: "sent" } };
    if (allowed && broker?.phone) {
      await save("loads", ctx.carrier.id, asking as unknown as Item);
      ctx.loads = ctx.loads.map((l) => (l.id === load.id ? asking : l));
      const url = absoluteUrl(`/api/channels/voice/broker?carrier=${encodeURIComponent(ctx.carrier.id)}&load=${encodeURIComponent(load.id)}`);
      if (await callBroker(ctx, asking, url)) return "sent" as const;
    }
    await passToOwner(ctx, { reason: `No email for ${broker?.company ?? "the broker"} on ${load.referenceNumber}${broker?.phone ? " and the AI couldn't call" : " or phone"}: reach them to book it at $${ask.toLocaleString()}.`, loadId: load.id, label: "Reached them", source: "email", to: "support" });
    return "queued" as const;
  }
  const at = new Date().toISOString();
  const updated: Load = { ...load, stage: "negotiating", targetRate: ask, updatedAt: at, bookRequest: { ask, askedAt: at, status: "drafted" } };
  await save("loads", ctx.carrier.id, updated as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? updated : l.offerGroupId && l.offerGroupId === load.offerGroupId && l.stage === "offered" ? { ...l, stage: "declined" as const, updatedAt: at } : l));
  for (const l of ctx.loads) if (l.offerGroupId === load.offerGroupId && l.id !== load.id && l.stage === "declined" && l.updatedAt === at) await save("loads", ctx.carrier.id, l as unknown as Item);

  const floor = floorFor(load, ctx.settings);
  const subject = load.offerEmail ? (/^re:/i.test(load.offerEmail.subject) ? load.offerEmail.subject : `Re: ${load.offerEmail.subject}`) : mail.subjectFor(load);
  return sendOrQueue(ctx, {
    purpose: "book_request",
    to,
    toName: broker?.contact || undefined,
    subject: subject.includes(load.referenceNumber) ? subject : `${subject} (${load.referenceNumber})`,
    body: mail.bookRequest(ctx.carrier, ctx.settings, load, ask, broker?.contact || undefined),
    inReplyTo: load.offerEmail?.messageId,
    loadId: load.id,
    amount: ask,
    withinRules: floor !== null && ask >= floor,
    ownerAsked: !!how.byOwner,
    why: `Ask ${broker?.company ?? "the broker"} to book ${load.lane.origin} → ${load.lane.destination} at $${ask.toLocaleString()}?`,
  });
}

/** The broker answered our price. The rules pick the answer; the email is a template with exactly that number. */
export async function answerRateReply(ctx: CarrierContext, load: Load, reply: { brokerRate: number | null; agreed: boolean; contactName: string | null }, sender: Sender) {
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const at = new Date().toISOString();
  if (reply.agreed && (!reply.brokerRate || reply.brokerRate >= (load.bookRequest?.ask ?? 0))) {
    const updated: Load = { ...load, updatedAt: at, bookRequest: { ...load.bookRequest!, status: "accepted", brokerOffer: reply.brokerRate ?? load.bookRequest?.ask } };
    await save("loads", ctx.carrier.id, updated as unknown as Item);
    await addActivity(ctx.carrier.id, event({ type: "negotiation_email", loadId: load.id, message: `${broker?.company ?? "Broker"} agreed to $${(load.bookRequest?.ask ?? 0).toLocaleString()}`, detail: `${load.referenceNumber} · waiting on their rate con`, severity: "success" }));
    return;
  }
  if (!reply.brokerRate) return false; // Nothing to decide on: the AI's own reply handles it.
  const answer = answerBroker(reply.brokerRate, load, ctx.settings, !!load.bookRequest?.countered);
  const withOffer: Load = { ...load, updatedAt: at, bookRequest: { ...(load.bookRequest ?? { ask: reply.brokerRate, askedAt: at, status: "sent" }), brokerOffer: reply.brokerRate } };
  await save("loads", ctx.carrier.id, withOffer as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? withOffer : l));
  const subject = /^re:/i.test(sender.subject) ? sender.subject : `Re: ${sender.subject}`;
  const name = reply.contactName ?? undefined;
  if (answer.action === "owner") {
    // Below the owner's lowest: they decide. The acceptance is ready to send if they want it.
    await sendOrQueue(ctx, {
      purpose: "accept",
      to: sender.from,
      toName: name,
      subject,
      body: mail.accept(ctx.carrier, ctx.settings, withOffer, reply.brokerRate, name),
      inReplyTo: sender.messageId,
      loadId: load.id,
      amount: reply.brokerRate,
      withinRules: false,
      why: `${broker?.company ?? "The broker"} offered $${reply.brokerRate.toLocaleString()} on ${load.referenceNumber}. ${answer.why} Send this to take it, or don't send to pass.`,
    });
    return true;
  }
  await sendOrQueue(ctx, {
    purpose: answer.action,
    to: sender.from,
    toName: name,
    subject,
    body: (answer.action === "accept" ? mail.accept : mail.counter)(ctx.carrier, ctx.settings, withOffer, answer.amount, name),
    inReplyTo: sender.messageId,
    loadId: load.id,
    amount: answer.amount,
    withinRules: true,
    why:
      answer.action === "accept"
        ? `${broker?.company ?? "The broker"} offered $${reply.brokerRate.toLocaleString()} on ${load.referenceNumber}, at or over your lowest. Accept it?`
        : `${broker?.company ?? "The broker"} offered $${reply.brokerRate.toLocaleString()} on ${load.referenceNumber}, under your lowest. Counter at $${answer.amount.toLocaleString()}?`,
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
  const booked: Load = {
    ...load,
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
    truckAfter = free ? { ...truck, currentLoadId: load.id, status: "on_load" } : truck.nextLoadId ? truck : { ...truck, nextLoadId: load.id };
    if (truckAfter !== truck) {
      await save("trucks", ctx.carrier.id, truckAfter as unknown as Item);
      ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? truckAfter! : t));
    }
  }
  await addActivity(ctx.carrier.id, event({ type: "booked", loadId: load.id, message: `Booked: ${load.lane.origin} → ${load.lane.destination}`, detail: `${truck?.unitNumber ?? ""} · $${agreed.toLocaleString()}`, severity: "success" }));
  await textNewLoad(ctx, booked).catch((e) => console.error("[booking] new-load text failed", e));
  return { load: booked, truck: truckAfter };
}

/** The driver's text about a new load, in their language. False when it couldn't go (no texting, no number, STOP). */
export async function textNewLoad(ctx: CarrierContext, load: Load): Promise<boolean> {
  if (!twilioConfigured()) return false;
  const truck = ctx.trucks.find((t) => t.id === load.truckId);
  const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
  const to = driver ? toE164(driver.phone) : null;
  if (!driver || !to || driver.prefs?.smsOptOut) return false;
  const text = NEW_LOAD[driver.prefs?.language ?? "en"]({
    ref: load.referenceNumber,
    from: `${load.lane.origin}, ${load.lane.originState}`,
    to: `${load.lane.destination}, ${load.lane.destState}`,
    pickup: load.pickupWindow,
    delivery: load.deliveryWindow,
  });
  const sid = await sendSms(to, text);
  await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms" });
  await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: text, data: { kind: "new_load", loadId: load.id } });
  return true;
}

