import { EQUIPMENT, LANES } from "./mock-data";
import { computeEconomics, computeLoadScore } from "./scoring";
import { cityCoords, distanceMiles, legHours, transitWindow } from "./trip-geo";
import { homeTonight, hoursToHome, reloadMarket } from "./home";
import { laneFits } from "./run-types";
import type {
  ActivityEvent,
  ActivityType,
  Broker,
  CallTranscriptLine,
  EquipmentType,
  Incident,
  RunType,
  IncidentStep,
  IncidentType,
  Lane,
  LiveBrokerCall,
  Load,
  LoadStage,
  NegotiationMessage,
  Truck,
  VoiceCall,
} from "./types";

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const chance = (p: number) => Math.random() < p;

function costsForLane(miles: number, deadheadMiles: number) {
  const fuelCost = Math.round(((miles + deadheadMiles) / 6.4) * 3.89);
  const tollCost = randInt(0, 145);
  return { fuelCost, tollCost };
}

function pickBroker(brokers: Broker[], excludeTiers: Broker["tier"][] = []): Broker {
  const pool = excludeTiers.length ? brokers.filter((b) => !excludeTiers.includes(b.tier)) : brokers;
  return pick(pool.length ? pool : brokers);
}

/** Where a truck will be empty and ready for its next pickup. */
export interface TruckOrigin {
  city: string;
  state: string;
}

export interface LanePlacement {
  lane: Lane;
  deadheadMiles: number;
}

/** Every lane ranked by how far its pickup is from `from`, with the real (road-adjusted) deadhead to reach it —
 *  the dispatcher's first question is always "what's loading near where this truck empties out?". */
function lanesNear(from: TruckOrigin | undefined, fits?: (lane: Lane) => boolean): LanePlacement[] | null {
  const at = from ? cityCoords(from.city, from.state) : undefined;
  if (!at) return null;
  // Only work this driver takes (local, regional, long haul); if none of it is near, the nearest of whatever is.
  const pool = fits && LANES.some(fits) ? LANES.filter(fits) : LANES;
  return pool.map((lane) => {
    const origin = cityCoords(lane.origin, lane.originState);
    const miles = origin ? distanceMiles(at, origin) * 1.18 : Infinity;
    return { lane, deadheadMiles: miles < 15 ? randInt(3, 25) : Math.round(miles) };
  }).sort((a, b) => a.deadheadMiles - b.deadheadMiles);
}

/** One of the two lanes loading closest to `from`, or undefined when the location isn't known. */
export function pickLaneNear(from: TruckOrigin | undefined, fits?: (lane: Lane) => boolean): LanePlacement | undefined {
  const ranked = lanesNear(from, fits);
  return ranked ? pick(ranked.slice(0, 2)) : undefined;
}

export function createSourcedLoad(
  brokers: Broker[],
  carrierId: string,
  refSeed: number,
  truckId: string | null,
  isChained: boolean,
  excludeTiers: Broker["tier"][] = [],
  equipmentType?: EquipmentType,
  placement?: LanePlacement,
  /** Broker id → extra % the AI asks for, for brokers that pay slowly or dispute detention. */
  surcharges: Record<string, number> = {},
): Load {
  const broker = pickBroker(brokers, excludeTiers);
  const lane = placement?.lane ?? pick(LANES);
  const marketRate = lane.miles * lane.marketRpm;
  const listedRate = Math.round(marketRate * (0.86 + Math.random() * 0.1));
  const surchargePct = surcharges[broker.id];
  const targetRate = Math.round(marketRate * (0.98 + Math.random() * 0.07) * (1 + (surchargePct ?? 0) / 100));
  const deadheadMiles = placement?.deadheadMiles ?? randInt(0, 85);
  const { fuelCost, tollCost } = costsForLane(lane.miles, deadheadMiles);
  const now = new Date().toISOString();

  const projected = computeEconomics(targetRate, lane.miles, deadheadMiles, fuelCost, tollCost);
  const score = computeLoadScore({
    rate: targetRate,
    netProfit: projected.netProfit,
    miles: lane.miles,
    deadheadMiles,
    rpm: projected.rpm,
    marketRpm: lane.marketRpm,
    brokerReliability: broker.reliability,
  });

  return {
    id: uid("load"),
    referenceNumber: `BR-${20000 + refSeed}`,
    stage: "sourced",
    source: pick(["DAT One", "Truckstop", "Numeo", "Direct Email", "Loadsmart"]),
    brokerId: broker.id,
    lane,
    equipmentType: equipmentType ?? pick(EQUIPMENT),
    weight: randInt(22000, 44500),
    pickupWindow: `${pick(["today", "tomorrow"])}, ${randInt(6, 14)}:00–${randInt(15, 19)}:00`,
    deliveryWindow: transitWindow(lane.miles),
    listedRate,
    targetRate,
    bookedRate: null,
    deadheadMiles,
    fuelCost,
    tollCost,
    deadheadCost: projected.deadheadCost,
    commission: projected.commission,
    netProfit: null,
    rpm: null,
    score,
    carrierId,
    truckId,
    messages: [],
    calls: [],
    documents: [],
    createdAt: now,
    updatedAt: now,
    isChained,
    aiConfidence: randInt(76, 98),
    ticksInStage: 0,
    progressPct: 4,
    surchargePct,
  };
}

export interface OfferOptions {
  excludeTiers?: Broker["tier"][];
  /** Where the truck will be free — offers are sourced from the lanes loading nearest to it. */
  from?: TruckOrigin;
  equipmentType?: EquipmentType;
  surcharges?: Record<string, number>;
  /** The driver's home base, so every option says how far from home it leaves them. */
  homeBase?: string;
  /** Home time is getting tight (or the carrier said home first): only loads that bring the driver closer count. */
  headHome?: boolean;
  /** Local, regional or long haul: only lanes that fit how this driver runs are sourced. */
  runType?: RunType;
}

/** AI has scanned the boards and scored several candidates for one truck — driver/carrier picks one. */
export function createLoadOfferBatch(
  brokers: Broker[],
  carrierId: string,
  truckId: string,
  refSeed: number,
  isChained: boolean,
  count = 3,
  opts: OfferOptions = {},
): Load[] {
  const home = opts.homeBase;
  const hoursHomeFrom = (city: string, state: string) => (home ? hoursToHome(city, state, home) : null);
  const startHoursHome = opts.from ? hoursHomeFrom(opts.from.city, opts.from.state) : null;

  // What's loading near the truck; when it's time to head home, of those, the ones delivering closest to home.
  const runType = opts.runType;
  const near = lanesNear(opts.from, runType && home ? (lane) => laneFits(lane, runType, home) : undefined);
  const placements = near
    ? opts.headHome && home
      ? near.slice(0, count * 2).sort((a, b) => (hoursHomeFrom(a.lane.destination, a.lane.destState) ?? 99) - (hoursHomeFrom(b.lane.destination, b.lane.destState) ?? 99)).slice(0, count)
      : near.slice(0, count)
    : undefined;

  const candidates = Array.from({ length: count }, (_, i) => {
    const base = createSourcedLoad(brokers, carrierId, refSeed + i, truckId, isChained, opts.excludeTiers, opts.equipmentType, placements?.[i], opts.surcharges);
    const { netProfit, rpm } = computeEconomics(base.targetRate, base.lane.miles, base.deadheadMiles, base.fuelCost, base.tollCost);
    const hoursHomeAfter = hoursHomeFrom(base.lane.destination, base.lane.destState) ?? undefined;
    return {
      ...base,
      stage: "offered" as const,
      netProfit,
      rpm,
      progressPct: 16,
      hoursHomeAfter,
      homeTonight: hoursHomeAfter !== undefined && homeTonight(base.lane.miles, base.deadheadMiles, hoursHomeAfter),
      // Brings the driver meaningfully closer to home than where the truck empties out now.
      homeTimeFit: hoursHomeAfter !== undefined && startHoursHome !== null && hoursHomeAfter < startHoursHome - 3,
      reloadMarket: reloadMarket(base.lane.destination, base.lane.destState),
    };
  });

  const offerGroupId = uid("offer");
  // The score itself only carries broker *reliability*, not the fraud-risk flag Broker Shield shows on the card.
  const brokerById = new Map(brokers.map((b) => [b.id, b]));
  const isLowRisk = (c: (typeof candidates)[number]) => (brokerById.get(c.brokerId)?.fraudRisk ?? "low") === "low";
  // A dispatcher's call on each load: what it nets per hour of the driver's time, marked down when it strands the truck
  // somewhere nothing ships back out of. When it's time to head home, getting closer to home comes first.
  const value = (c: (typeof candidates)[number]) => {
    if (opts.headHome && c.hoursHomeAfter !== undefined) return -c.hoursHomeAfter * 1000 + (c.netProfit ?? 0);
    const perHour = (c.netProfit ?? 0) / legHours(c.lane.miles, c.deadheadMiles);
    return c.reloadMarket === "weak" ? perHour * 0.85 : perHour;
  };
  const top = (pool: typeof candidates) => pool.reduce((a, b) => (value(b) > value(a) ? b : a));
  // Never pick a load that loses money when one that doesn't is on the table.
  const profitable = candidates.filter((c) => (c.netProfit ?? 0) > 0);
  const pool = profitable.length ? profitable : candidates;
  // Broker Shield: a clean broker wins unless a flagged one is clearly better. Those get extra checks, not a pass.
  const best = top(pool);
  const clean = pool.filter(isLowRisk);
  const pick = clean.length && !opts.headHome && value(top(clean)) >= value(best) * 0.8 ? top(clean) : best;

  return candidates.map((c) => ({ ...c, offerGroupId, recommended: c.id === pick.id }));
}

interface OfferResolution {
  loads: Load[];
  events: ActivityEvent[];
}

/** Chosen load moves back into the normal pipeline; the rest of its offer group is declined. */
export function resolveLoadOffer(loads: Load[], offerGroupId: string, chosenId: string, actor: "driver" | "carrier" | "ai"): OfferResolution {
  const group = loads.filter((l) => l.offerGroupId === offerGroupId);
  const chosen = group.find((l) => l.id === chosenId);
  if (!chosen) return { loads, events: [] };

  const now = new Date().toISOString();
  const updated = loads.map((l) => {
    if (l.offerGroupId !== offerGroupId) return l;
    if (l.id === chosenId) {
      return { ...l, stage: "scoring" as const, progressPct: 12, updatedAt: now, ticksInStage: 0 };
    }
    return { ...l, stage: "declined" as const, progressPct: 100, updatedAt: now };
  });

  const actorLabel = actor === "driver" ? "Driver selected the next load" : actor === "carrier" ? "Carrier selected the next load" : "AI auto-selected the top-scored load";
  const events: ActivityEvent[] = [
    mkEvent(
      chosen.carrierId,
      chosen.id,
      "offer_selected",
      actorLabel,
      `${chosen.lane.origin} → ${chosen.lane.destination} · est. net $${(chosen.netProfit ?? 0).toLocaleString()} · ${group.length - 1} other option${group.length - 1 === 1 ? "" : "s"} declined`,
      "success",
    ),
  ];

  return { loads: updated, events };
}

/** Offers left unattended past the timeout get auto-resolved when autonomy is enabled. */
export function autoResolveStaleOffers(loads: Load[], staleMs: number, autoBookEnabled: boolean): OfferResolution {
  if (!autoBookEnabled) return { loads, events: [] };
  const now = Date.now();
  const groupIds = new Set(
    loads.filter((l) => l.stage === "offered" && now - new Date(l.createdAt).getTime() > staleMs).map((l) => l.offerGroupId!),
  );

  let result = loads;
  const events: ActivityEvent[] = [];
  for (const groupId of groupIds) {
    const group = result.filter((l) => l.offerGroupId === groupId && l.stage === "offered");
    const best = group.find((l) => l.recommended) ?? group[0];
    if (!best) continue;
    const resolved = resolveLoadOffer(result, groupId, best.id, "ai");
    result = resolved.loads;
    events.push(...resolved.events);
  }
  return { loads: result, events };
}

const EMAIL_OPEN = (o: string, d: string, miles: number) =>
  `Hi, saw your ${o} to ${d} (${miles} mi) posted. We have a truck available. What's the best you can do on rate?`;
const AI_OPEN_ASK = [
  (amt: number) => `We can commit at $${amt.toLocaleString()} all-in. Truck is clean and ready to move within the appointment window.`,
  (amt: number) => `$${amt.toLocaleString()} is where we're at based on the lane and truck's availability. That's the number that works for us.`,
  (amt: number) => `Best we can do is $${amt.toLocaleString()}. Truck's ready to roll as soon as we can lock it in.`,
];
const AI_CONCEDE = [
  (amt: number) => `We can come down to $${amt.toLocaleString()} to get this locked in today.`,
  (amt: number) => `Alright, we can do $${amt.toLocaleString()} if that gets us confirmed now.`,
  (amt: number) => `We'll meet you closer. $${amt.toLocaleString()} works if we can lock the truck now.`,
];
const BROKER_LOW = (amt: number) => `Best I can do right now is $${amt.toLocaleString()}. Shipper's tight on budget this week.`;
const BROKER_ACCEPT = (amt: number) => `Alright, you've got it. $${amt.toLocaleString()} all-in. Sending the rate con over now.`;

const CALL_OPENERS = [
  (name: string, o: string, d: string) => `Hi ${name}, this is Backroute calling on the ${o} to ${d} load.`,
  (name: string, o: string, d: string) => `Hey ${name}, Backroute here on the ${o} to ${d} lane. Got a minute?`,
  (name: string, o: string, d: string) => `${name}, calling to close the loop on the ${o} to ${d} load.`,
  (name: string, o: string, d: string) => `Hey ${name}, it's Backroute. Quick call on ${o} to ${d} instead of another email.`,
  (name: string, o: string, d: string) => `${name}, good timing. Calling on ${o} to ${d} to see if we can get it locked today.`,
  (name: string, o: string, d: string) => `Hi ${name}, Backroute here. Following up live on ${o} to ${d}.`,
];
const CALL_BROKER_STALLS = [
  "Hey, let me pull it up. We're still a bit apart on rate.",
  "Sure, one sec... yeah, shipper's holding firm on budget.",
  "Good timing. Let me check where we landed.",
  "Oh hey, yeah, we're not far off but not quite there yet.",
  "Let me pull the load up... shipper hasn't moved much.",
  "One sec, switching screens. We're close, just need to close the gap.",
];
const CALL_AI_HOLDS = [
  (amt: number) => `We can commit right now at $${amt.toLocaleString()} and have the truck moving within the hour.`,
  (amt: number) => `$${amt.toLocaleString()} is where we can lock this in immediately. Truck's close by and empty.`,
  (amt: number) => `We can make $${amt.toLocaleString()} work today if we get this confirmed now.`,
  (amt: number) => `$${amt.toLocaleString()} gets a truck rolling on this one right now, no waiting around.`,
  (amt: number) => `Here's where we can land it: $${amt.toLocaleString()}, ready to dispatch as soon as you say go.`,
  (amt: number) => `We can hold at $${amt.toLocaleString()}. Truck's close by and ready to move once it's confirmed.`,
];
const CALL_BROKER_CHECKS = [
  "Let me check with the shipper... okay, I can make that work.",
  "Give me a second to confirm... alright, that'll clear.",
  "Hold on... yeah, we're good there.",
  "Let me run that by the desk... that number works.",
  "One sec, checking our floor... okay, we can do that.",
  "Let me see what we've got room for... that'll clear on our end.",
];
const CALL_AI_CLOSES = [
  (amt: number) => `Confirming $${amt.toLocaleString()} all-in. Sending MC and insurance now.`,
  (amt: number) => `Locking in $${amt.toLocaleString()}. Sending our packet over now.`,
  (amt: number) => `$${amt.toLocaleString()} confirmed. Sending carrier packet, we'll be rolling shortly.`,
  (amt: number) => `Appreciate it, $${amt.toLocaleString()} it is. Packet's headed your way now.`,
  (amt: number) => `Good deal, $${amt.toLocaleString()} confirmed. Sending insurance and authority now.`,
  (amt: number) => `Locking it in at $${amt.toLocaleString()}. Truck will be moving shortly after.`,
];
const CALL_BROKER_CONFIRMS = [
  "You're booked. Rate con going out now.",
  "Deal. I'll send the rate confirmation over in a few minutes.",
  "Locking the truck on my end. Paperwork's on its way.",
  "Appreciate it, you're all set. Rate con's on its way.",
  "That's a deal, getting the paperwork moving on our side now.",
  "Good to go, booking it now. You'll have the confirmation shortly.",
];

const LIVE_CALL_MARKET = [
  (rpm: string, amt: number) => `Lane's running about ${rpm} a mile this week, so the going rate is right at $${amt.toLocaleString()}.`,
  (rpm: string, amt: number) => `Market on this lane is ${rpm} a mile right now. That puts it at $${amt.toLocaleString()}.`,
];
const LIVE_CALL_BROKER_MEET = [
  (amt: number) => `I hear you. I could maybe stretch to $${amt.toLocaleString()}. That's about my ceiling.`,
  (amt: number) => `Let me see... I can come up to $${amt.toLocaleString()}, but that's pushing it.`,
  (amt: number) => `Okay, how about we meet at $${amt.toLocaleString()}?`,
];
const LIVE_CALL_AI_VALUE = [
  (dh: number, amt: number) => `Our truck is empty ${dh} miles out and can make your window. $${amt.toLocaleString()} and you can book it right now.`,
  (dh: number, amt: number) => `The truck is ${dh} miles from the shipper with a clean safety record. At $${amt.toLocaleString()} it's yours.`,
];

/** Ring time before the broker picks up, then each line takes roughly as long as it would to say it. */
const CALL_RING_MS = 2600;
const lineMs = (text: string) => Math.max(2800, text.split(/\s+/).length * 330);

/** Scripts a whole broker call the AI is about to make: open, hear the broker's number, argue it with the
 *  lane's market rate and the truck's position, meet part of the way, close. The final number comes from
 *  where the negotiation thread left off, so the call never contradicts the emails before it. */
export function scriptBrokerCall(load: Load, broker: Broker | undefined): LiveBrokerCall {
  const b = broker ?? ({ contact: "Broker", company: load.source } as Broker);
  const aiOffers = load.messages.filter((m) => m.direction === "outbound" && m.offerAmount);
  const brokerOffers = load.messages.filter((m) => m.direction === "inbound" && m.offerAmount);
  const ask = Math.max(aiOffers.length ? aiOffers[aiOffers.length - 1].offerAmount! : load.targetRate, Math.round(load.targetRate * 0.97));
  const opening = brokerOffers.length ? brokerOffers[brokerOffers.length - 1].offerAmount! : load.listedRate;
  const brokerMeet = Math.round(opening + (ask - opening) * 0.55);
  const final = Math.max(brokerMeet, Math.round(ask - (ask - brokerMeet) * 0.35));
  const market = Math.round(load.lane.miles * load.lane.marketRpm);
  const rpm = `$${load.lane.marketRpm.toFixed(2)}`;

  const script: Omit<LiveBrokerCall["lines"][number], "atMs">[] = [
    { speaker: "ai", text: pick(CALL_OPENERS)(b.contact.split(" ")[0], load.lane.origin, load.lane.destination) },
    { speaker: "broker", text: BROKER_LOW(opening), offer: opening },
    { speaker: "ai", text: `${pick(LIVE_CALL_MARKET)(rpm, market)} We're at $${ask.toLocaleString()}.`, offer: ask },
    { speaker: "broker", text: pick(LIVE_CALL_BROKER_MEET)(brokerMeet), offer: brokerMeet },
    { speaker: "ai", text: pick(LIVE_CALL_AI_VALUE)(Math.max(6, load.deadheadMiles), final), offer: final },
    { speaker: "broker", text: pick(CALL_BROKER_CHECKS) },
    { speaker: "ai", text: pick(CALL_AI_CLOSES)(final), offer: final },
    { speaker: "broker", text: pick(CALL_BROKER_CONFIRMS) },
  ];
  let at = CALL_RING_MS;
  const lines = script.map((line) => {
    const timed = { ...line, atMs: at };
    at += lineMs(line.text);
    return timed;
  });
  return { id: uid("call"), startedAt: new Date().toISOString(), lines, durationMs: at + 800, openingOffer: opening, finalRate: final };
}

/** The call ended: the load is booked at the number the broker agreed to on the phone. */
export function finishBrokerCall(load: Load, broker: Broker | undefined): StepResult {
  const live = load.liveCall;
  if (!live) return { load, events: [] };
  const b = broker ?? ({ company: load.source, reliability: 70 } as Broker);
  const now = new Date().toISOString();
  const gain = live.finalRate - live.openingOffer;
  const call: VoiceCall = {
    id: live.id,
    status: "completed",
    startedAt: live.startedAt,
    durationSec: Math.round(live.durationMs / 1000),
    transcript: live.lines.map(({ speaker, text, offer }) => ({ speaker, text, offer })),
    outcome: `Booked at $${live.finalRate.toLocaleString()}${gain > 0 ? `, $${gain.toLocaleString()} over their first offer` : ""}`,
  };
  const next: Load = { ...load, liveCall: undefined, calls: [...load.calls, call], updatedAt: now, ticksInStage: 0 };
  if (load.stage !== "negotiating") return { load: next, events: [] };
  next.stage = "rate_confirmed";
  next.progressPct = STAGE_PROGRESS.rate_confirmed;
  next.bookedRate = live.finalRate;
  applyBookedEconomics(next, load, live.finalRate, b.reliability ?? 70);
  next.documents = [...load.documents, { id: uid("doc"), type: "rate_confirmation", name: `RateCon_${load.referenceNumber}.pdf`, generatedAt: now, status: "verified" }];
  return {
    load: next,
    events: [
      mkEvent(load.carrierId, load.id, "call_completed", `AI closed ${b.company} by phone at $${live.finalRate.toLocaleString()}`, gain > 0 ? `$${gain.toLocaleString()} more than the broker's first offer · rate con signed` : "Rate con signed", "success", "voice"),
    ],
  };
}

interface StepResult {
  load: Load;
  events: ActivityEvent[];
  truckUpdates?: Partial<Truck> & { id: string };
}

const STAGE_PROGRESS: Record<LoadStage, number> = {
  sourced: 4, scoring: 12, offered: 16, negotiating: 30, rate_confirmed: 44, booked: 54,
  dispatched: 64, at_pickup: 72, in_transit: 84, at_delivery: 94, delivered: 100, declined: 100, cancelled: 100,
};

function mkEvent(carrierId: string, loadId: string | undefined, type: ActivityType, message: string, detail: string, severity: ActivityEvent["severity"], channel?: ActivityEvent["channel"]): ActivityEvent {
  return { id: uid("act"), timestamp: new Date().toISOString(), type, message, detail, loadId, carrierId, severity, channel };
}

/** Recomputes the real expense breakdown — fuel, tolls, deadhead, and our 2% commission — once a rate is locked in. */
function applyBookedEconomics(next: Load, original: Load, finalAmt: number, brokerReliability: number) {
  const { fuelCost, tollCost, deadheadMiles, lane } = original;
  const { deadheadCost, commission, netProfit, rpm } = computeEconomics(finalAmt, lane.miles, deadheadMiles, fuelCost, tollCost);
  next.deadheadCost = deadheadCost;
  next.commission = commission;
  next.netProfit = netProfit;
  next.rpm = rpm;
  next.score = computeLoadScore({ rate: finalAmt, netProfit, miles: lane.miles, deadheadMiles, rpm, marketRpm: lane.marketRpm, brokerReliability });
}

export function advanceLoad(load: Load, broker: Broker | undefined, truck: Truck | undefined): StepResult {
  const events: ActivityEvent[] = [];
  const next: Load = { ...load, updatedAt: new Date().toISOString(), ticksInStage: load.ticksInStage + 1 };
  const b = broker ?? { contact: "Broker", company: load.source } as Broker;

  switch (load.stage) {
    case "sourced": {
      next.stage = "scoring";
      events.push(mkEvent(load.carrierId, load.id, "scoring_done", "AI scored a new load", `${load.lane.origin} → ${load.lane.destination} · est. net $${(load.targetRate - load.fuelCost - load.tollCost).toLocaleString()}`, "info"));
      break;
    }
    case "scoring": {
      next.stage = "negotiating";
      const msg: NegotiationMessage = {
        id: uid("msg"), channel: "email", direction: "outbound", from: "Backroute AI",
        timestamp: new Date().toISOString(), content: EMAIL_OPEN(load.lane.origin, load.lane.destination, load.lane.miles),
      };
      next.messages = [...load.messages, msg];
      events.push(mkEvent(load.carrierId, load.id, "negotiation_email", "AI opened negotiation by email", `${b.company} · ${load.lane.origin} → ${load.lane.destination}`, "info", "email"));
      break;
    }
    case "negotiating": {
      const rounds = load.messages.filter((m) => m.channel !== "voice").length;
      // Wherever the conversation actually left off — every branch below closes from here, not from a
      // fresh random number, so the deal never lands on a figure that contradicts what was just said.
      const priorAiOffers = load.messages.filter((m) => m.direction === "outbound" && m.offerAmount);
      const priorBrokerOffers = load.messages.filter((m) => m.direction === "inbound" && m.offerAmount);
      const threadAiLast = priorAiOffers.length ? priorAiOffers[priorAiOffers.length - 1].offerAmount! : load.targetRate;
      const threadBrokerLast = priorBrokerOffers.length ? priorBrokerOffers[priorBrokerOffers.length - 1].offerAmount! : load.listedRate;
      // A slow-pay premium is a real ask, and some brokers just give the load to another carrier instead.
      if (load.surchargePct && rounds >= 3 && chance(0.2)) {
        next.stage = "declined";
        next.progressPct = 100;
        next.cancellationReason = `${b.company} wouldn't pay the ${load.surchargePct}% slow-pay premium. The AI walked away and is finding another load.`;
        events.push(mkEvent(load.carrierId, load.id, "load_cancelled", `${b.company} passed on the slow-pay premium`, "The AI walked away and is finding another load", "info"));
        const truckUpdates = truck && truck.nextLoadId === load.id ? { id: truck.id, nextLoadId: null } : undefined;
        return { load: next, events, truckUpdates };
      }
      if (rounds >= 5 || chance(0.32)) {
        const goVoice = chance(0.4) && !load.calls.length;
        if (goVoice) {
          // Closes at exactly what the AI was last asking — the broker giving in, not a further discount
          // tacked on after they've already agreed to look into that number.
          const finalAmt = threadAiLast;
          const transcript: CallTranscriptLine[] = [
            { speaker: "ai", text: pick(CALL_OPENERS)(b.contact.split(" ")[0], load.lane.origin, load.lane.destination) },
            { speaker: "broker", text: pick(CALL_BROKER_STALLS) },
            { speaker: "ai", text: pick(CALL_AI_HOLDS)(threadAiLast) },
            { speaker: "broker", text: pick(CALL_BROKER_CHECKS) },
            { speaker: "ai", text: pick(CALL_AI_CLOSES)(finalAmt) },
            { speaker: "broker", text: pick(CALL_BROKER_CONFIRMS) },
          ];
          const call: VoiceCall = { id: uid("call"), status: "completed", startedAt: new Date().toISOString(), durationSec: randInt(95, 240), transcript, outcome: `Booked at $${finalAmt.toLocaleString()}` };
          next.calls = [...load.calls, call];
          next.bookedRate = finalAmt;
          next.stage = "rate_confirmed";
          applyBookedEconomics(next, load, finalAmt, b.reliability ?? 70);
          next.documents = [...load.documents, { id: uid("doc"), type: "rate_confirmation", name: `RateCon_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" }];
          events.push(mkEvent(load.carrierId, load.id, "call_completed", "Voice agent closed the deal by phone", `${b.company} · $${finalAmt.toLocaleString()} all-in`, "success", "voice"));
        } else {
          // Same principle without a call: the broker accepts the AI's current ask outright.
          const finalAmt = threadAiLast;
          const msg: NegotiationMessage = { id: uid("msg"), channel: "sms", direction: "inbound", from: b.contact, timestamp: new Date().toISOString(), content: BROKER_ACCEPT(finalAmt), offerAmount: finalAmt };
          next.messages = [...load.messages, msg];
          next.bookedRate = finalAmt;
          next.stage = "rate_confirmed";
          applyBookedEconomics(next, load, finalAmt, b.reliability ?? 70);
          next.documents = [...load.documents, { id: uid("doc"), type: "rate_confirmation", name: `RateCon_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" }];
          events.push(mkEvent(load.carrierId, load.id, "rate_confirmed", "Rate confirmed and validated", `${b.company} · $${finalAmt.toLocaleString()} all-in`, "success", "sms"));
        }
      } else {
        const isAiTurn = rounds % 2 === 0;
        // The AI opens at its best, data-driven ask (target). From there it gives a little ground each of its
        // own turns — never below a floor that protects margin — while the broker concedes up from their low
        // opener toward wherever the AI currently stands. Two sides closing the gap, not one side standing still.
        const aiFloor = Math.round(load.targetRate * 0.94);
        const amt = isAiTurn
          ? priorAiOffers.length === 0
            ? load.targetRate
            : Math.max(aiFloor, Math.round(threadAiLast - (threadAiLast - threadBrokerLast) * 0.15))
          : Math.round(threadBrokerLast + (threadAiLast - threadBrokerLast) * 0.3);
        const isFirstAiAsk = isAiTurn && priorAiOffers.length === 0;
        const msg: NegotiationMessage = {
          id: uid("msg"), channel: pick(["email", "sms"]), direction: isAiTurn ? "outbound" : "inbound",
          from: isAiTurn ? "Backroute AI" : b.contact, timestamp: new Date().toISOString(),
          content: isAiTurn ? pick(isFirstAiAsk ? AI_OPEN_ASK : AI_CONCEDE)(amt) : BROKER_LOW(amt), offerAmount: amt,
        };
        next.messages = [...load.messages, msg];
        events.push(mkEvent(load.carrierId, load.id, isAiTurn ? "negotiation_email" : "negotiation_sms", isAiTurn ? "AI sent a counter-offer" : "Broker replied with a counter", `${b.company} · $${amt.toLocaleString()}`, "info", msg.channel));
      }
      break;
    }
    case "rate_confirmed": {
      next.stage = "booked";
      events.push(mkEvent(load.carrierId, load.id, "tms_synced", "Load synced to TMS", `Reference ${load.referenceNumber} written to carrier TMS`, "success"));
      break;
    }
    case "booked": {
      if (!truck) break;
      next.stage = "dispatched";
      next.progressPct = STAGE_PROGRESS.dispatched;
      events.push(mkEvent(load.carrierId, load.id, "dispatched", "Driver dispatched", `${truck.unitNumber} en route to ${load.lane.origin}`, "info"));
      return { load: next, events, truckUpdates: { id: truck.id, status: "on_load", currentLoadId: load.id } };
    }
    // dispatched / at_pickup / in_transit / at_delivery are intentionally absent here: once a load is
    // dispatched it's the driver's load, and only confirmLoadStage (an explicit driver tap) may advance
    // it further. The automatic tick loop's candidate filter excludes these stages entirely (store.ts),
    // so this switch should never actually see them — no case needed.
    default:
      break;
  }

  next.progressPct = STAGE_PROGRESS[next.stage];
  return { load: next, events };
}

const MANUAL_STAGE_ADVANCE: Partial<Record<LoadStage, LoadStage>> = {
  dispatched: "at_pickup",
  at_pickup: "in_transit",
  in_transit: "at_delivery",
  at_delivery: "delivered",
};

/**
 * Lets the driver confirm a physical milestone (arrived, loaded, delivered) instantly instead of
 * waiting on the automatic tick loop — same side effects as advanceLoad's equivalent transitions
 * (BOL/POD/invoice generation, freeing the truck on delivery), just decisive rather than randomized.
 */
export function confirmLoadStage(load: Load, truck: Truck | undefined): StepResult {
  const nextStage = MANUAL_STAGE_ADVANCE[load.stage];
  if (!nextStage) return { load, events: [] };

  const next: Load = { ...load, stage: nextStage, updatedAt: new Date().toISOString(), ticksInStage: 0, progressPct: STAGE_PROGRESS[nextStage] };
  const events: ActivityEvent[] = [];

  if (nextStage === "at_pickup" || nextStage === "at_delivery") {
    const key = nextStage === "at_pickup" ? "arrivedPickupAt" : "arrivedDeliveryAt";
    next.tripChecklist = { ...load.tripChecklist, [key]: next.updatedAt };
  }

  if (nextStage === "at_pickup") {
    events.push(mkEvent(load.carrierId, load.id, "check_call", "Driver confirmed arrival at pickup", `${load.lane.origin}, ${load.lane.originState}`, "info"));
  } else if (nextStage === "in_transit") {
    // A BOL the driver already uploaded from the pickup checklist is the real one; only stand one in otherwise.
    if (!load.documents.some((d) => d.type === "bol")) {
      next.documents = [...load.documents, { id: uid("doc"), type: "bol", name: `BOL_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" }];
    }
    events.push(mkEvent(load.carrierId, load.id, "document_captured", "Driver confirmed loaded, BOL captured", `Loaded ${load.weight.toLocaleString()} lbs · departing ${load.lane.origin}`, "success"));
  } else if (nextStage === "at_delivery") {
    events.push(mkEvent(load.carrierId, load.id, "check_call", "Driver confirmed arrival at delivery", `${load.lane.destination}, ${load.lane.destState}`, "info"));
  } else if (nextStage === "delivered") {
    const hasPod = load.documents.some((d) => d.type === "pod");
    next.documents = [
      ...load.documents,
      ...(hasPod ? [] : [{ id: uid("doc"), type: "pod" as const, name: `POD_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" as const }]),
      { id: uid("doc"), type: "invoice", name: `Invoice_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" },
    ];
    events.push(mkEvent(load.carrierId, load.id, "delivered", "Driver confirmed delivery, POD captured, invoice generated", `${load.referenceNumber} · net $${(load.netProfit ?? 0).toLocaleString()}`, "success"));
  }

  const truckUpdates =
    nextStage === "delivered" && truck
      ? { id: truck.id, status: "available" as const, currentLoadId: null, currentCity: load.lane.destination, currentState: load.lane.destState }
      : undefined;
  return { load: next, events, truckUpdates };
}

export function shouldChainNextLoad(load: Load, truck: Truck | undefined): boolean {
  return !!truck && load.stage === "in_transit" && !truck.nextLoadId && chance(0.5);
}

const PUSH_REQUEST_COPY: Record<"driver" | "carrier", (target: number) => string> = {
  driver: (target) => `Driver asked us to push harder on this one. Following up to see if we can get closer to $${target.toLocaleString()}.`,
  carrier: (target) => `Following up per carrier request. Any room to move toward $${target.toLocaleString()} on this one?`,
};

const COUNTER_REQUEST_COPY: Record<"driver" | "carrier", (target: number) => string> = {
  driver: (target) => `Driver countered at $${target.toLocaleString()}. Going back to the broker with that number now.`,
  carrier: (target) => `Carrier countered at $${target.toLocaleString()}. Going back to the broker with that number now.`,
};

/** Wherever the AI's ask actually stands in the live thread right now — it may have conceded below
 *  load.targetRate over the course of the back-and-forth, so anything that "asks for more" needs to build
 *  from here, not from the (possibly stale, possibly already-conceded-past) target field. */
function currentAiAsk(load: Load): number {
  const aiOffers = load.messages.filter((m) => m.direction === "outbound" && m.offerAmount);
  const threadAiLast = aiOffers.length ? aiOffers[aiOffers.length - 1].offerAmount! : load.targetRate;
  return Math.max(load.targetRate, threadAiLast);
}

export function suggestedCounter(load: Load): number {
  const base = currentAiAsk(load);
  return Math.min(Math.max(Math.round(base * 1.06), base + 50), Math.round(load.listedRate * 1.3));
}

/** True when the AI just sent the broker a number and hasn't heard back yet. Pushing for more in that window
 *  would mean asking the broker for a higher number before they've even had a chance to respond to the last
 *  one we sent — the kind of flip-flop that makes a carrier look unsure of its own ask. A completed call
 *  always ends with the broker speaking last, so it clears this regardless of the written thread's order. */
export function isAwaitingBrokerReply(load: Load): boolean {
  const lastMsg = load.messages[load.messages.length - 1];
  const lastCall = load.calls[load.calls.length - 1];
  const lastMsgTime = lastMsg ? new Date(lastMsg.timestamp).getTime() : -Infinity;
  const lastCallTime = lastCall ? new Date(lastCall.startedAt).getTime() : -Infinity;
  if (lastCallTime > lastMsgTime) return false;
  return lastMsg ? lastMsg.direction === "outbound" : false;
}

/** The one place a human (driver or carrier) can ask the AI to go back and negotiate harder — still no human dispatcher involved.
 *  Optionally pass a specific dollar amount the driver/carrier is asking for, like a real dispatcher relaying a target number. */
export function pushForBetterRate(
  load: Load,
  broker: Broker | undefined,
  actor: "driver" | "carrier",
  requestedAmount?: number,
): { load: Load; events: ActivityEvent[] } {
  if (load.stage !== "negotiating") return { load, events: [] };
  if (isAwaitingBrokerReply(load)) return { load, events: [] };
  const b = broker ?? ({ contact: "Broker", company: load.source } as Broker);

  const base = currentAiAsk(load);
  const ceiling = Math.round(load.listedRate * 1.3);
  const floor = base;
  const hasSpecificAsk = typeof requestedAmount === "number" && Number.isFinite(requestedAmount) && requestedAmount > floor;
  const newTarget = hasSpecificAsk ? Math.min(Math.round(requestedAmount!), ceiling) : Math.min(Math.max(Math.round(base * 1.05), base + 40), ceiling);

  const msg: NegotiationMessage = {
    id: uid("msg"),
    channel: "email",
    direction: "outbound",
    from: "Backroute AI",
    timestamp: new Date().toISOString(),
    content: hasSpecificAsk ? COUNTER_REQUEST_COPY[actor](newTarget) : PUSH_REQUEST_COPY[actor](newTarget),
    offerAmount: newTarget,
  };

  const next: Load = { ...load, targetRate: newTarget, messages: [...load.messages, msg], updatedAt: new Date().toISOString() };
  const events: ActivityEvent[] = [
    mkEvent(
      load.carrierId,
      load.id,
      "negotiation_email",
      actor === "driver"
        ? (hasSpecificAsk ? `Driver countered at $${newTarget.toLocaleString()}` : "Driver asked AI to push for a better rate")
        : (hasSpecificAsk ? `Carrier countered at $${newTarget.toLocaleString()}` : "Carrier asked AI to push for a better rate"),
      `${b.company} · new target $${newTarget.toLocaleString()}`,
      "info",
      "email",
    ),
  ];
  return { load: next, events };
}

export type InstructionCategory = "rate" | "detention" | "schedule" | "payment" | "general";

/** Pull a plausible dollar figure out of free text like "can you get 2200" or "ask for $500 more". */
export function extractDollarAmount(text: string): number | undefined {
  const match = text.match(/\$?\s?(\d{3,5}(?:\.\d+)?)/);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 200 && n <= 20000 ? Math.round(n) : undefined;
}

/** Reads a free-text ask the way a dispatcher would triage it, so the AI can act on more than just a rate. */
export function classifyInstruction(text: string): InstructionCategory {
  const c = text.toLowerCase();
  // An explicit "$500" is an unambiguous ask — treat it as the rate even if other keywords (e.g. "pickup") are also present.
  if (/\$\s?\d{3,5}/.test(text)) return "rate";
  if (/\b(detention|lumper|accessorial)\b/.test(c)) return "detention";
  if (/\b(pickup|pick[\s-]?up|appointment|reschedule|earlier|later)\b/.test(c)) return "schedule";
  if (/\b(quick\s?pay|net[\s-]?\d+|payment terms|pay faster|faster pay|payment cycle)\b/.test(c)) return "payment";
  const wantsMore = /\b(more|higher|better|push|bump|raise|counter)\b/.test(c);
  const aboutMoney = /\b(rate|money|pay|\$|price|dollar)\b/.test(c);
  if ((wantsMore && aboutMoney) || extractDollarAmount(text) !== undefined) return "rate";
  return "general";
}

function instructionMessage(category: InstructionCategory, text: string, b: Broker): NegotiationMessage {
  const content =
    category === "detention"
      ? `Also flagging detention/lumper terms on this one. Can you confirm what's covered if we run over on time?`
      : category === "schedule"
        ? `Any flexibility on the pickup window? We can move earlier or later if it helps lock this in.`
        : category === "payment"
          ? `Quick one on terms, ${b.contact.split(" ")[0]}. Any chance of quick pay or a shorter cycle on this load?`
          : `Also wanted to flag on this one: "${text}"`;
  return { id: uid("msg"), channel: "email", direction: "outbound", from: "Backroute AI", timestamp: new Date().toISOString(), content };
}

/** The general version of "push for better rate" — driver/carrier can tell the AI ANY ask (money, detention terms,
 *  pickup timing, payment terms, or anything else) once a load is actively negotiating, and the AI relays it to the
 *  broker appropriately instead of only handling a fixed rate bump. */
export function applyNegotiationInstruction(
  load: Load,
  broker: Broker | undefined,
  actor: "driver" | "carrier",
  text: string,
): { load: Load; events: ActivityEvent[] } {
  if (load.stage !== "negotiating") return { load, events: [] };
  const category = classifyInstruction(text);
  if (category === "rate") {
    return pushForBetterRate(load, broker, actor, extractDollarAmount(text));
  }

  const b = broker ?? ({ contact: "Broker", company: load.source } as Broker);
  const msg = instructionMessage(category, text, b);
  const next: Load = { ...load, messages: [...load.messages, msg], updatedAt: new Date().toISOString() };
  const events: ActivityEvent[] = [
    mkEvent(
      load.carrierId,
      load.id,
      "negotiation_email",
      actor === "driver" ? "Driver asked AI to raise something with the broker" : "Carrier asked AI to raise something with the broker",
      `${b.company} · ${text}`,
      "info",
      "email",
    ),
  ];
  return { load: next, events };
}

export interface OfferAskDraft {
  category: InstructionCategory;
}

const OFFER_PENDING_REPLY: Record<Exclude<InstructionCategory, "rate">, (company: string) => string> = {
  detention: (company) => `Reached out to ${company} about detention terms. Waiting on their response.`,
  schedule: (company) => `Reached out to ${company} about the pickup window. Waiting on their response.`,
  payment: (company) => `Reached out to ${company} about payment terms. Waiting on their response.`,
  general: (company) => `Reached out to ${company}. Waiting on their response.`,
};

/**
 * The AI already set this offer's rate from lane, broker, and market data — that's its strongest data-driven
 * ask, not a starting bid to sweeten on request. Pushing further is what the post-selection negotiation flow is
 * for (already gated on an actual broker response there), so a rate ask here doesn't touch the broker or the
 * card at all — it just points to where that capability actually lives.
 */
const RATE_REDIRECT_REPLY =
  "This offer already reflects our strongest data-driven ask for this lane and broker. Select the load and the AI can keep pushing the broker directly during negotiation.";

/**
 * The offer-card equivalent of applyNegotiationInstruction, scoped to what makes sense before a load is booked:
 * a question about detention, schedule, payment terms, or anything else — not rate, which the AI already set
 * optimally and which only makes sense to keep pushing once the load is selected and actually negotiating.
 * Phase one logs the outbound question and hands back what to show while waiting on the broker.
 */
export function draftOfferAsk(load: Load, broker: Broker | undefined, text: string): { load: Load; draft: OfferAskDraft; pendingReply: string; resolved: boolean } {
  if (load.stage !== "offered") return { load, draft: { category: "general" }, pendingReply: "", resolved: true };
  const category = classifyInstruction(text);

  if (category === "rate") {
    return { load, draft: { category }, pendingReply: RATE_REDIRECT_REPLY, resolved: true };
  }

  const b = broker ?? ({ contact: "Broker", company: load.source } as Broker);
  const msg = instructionMessage(category, text, b);
  return {
    load: { ...load, messages: [...load.messages, msg], updatedAt: new Date().toISOString() },
    draft: { category },
    pendingReply: OFFER_PENDING_REPLY[category](b.company),
    resolved: false,
  };
}

/** Phase two — the broker's actual answer to a detention/schedule/payment question or general ask. */
export function resolveOfferAsk(load: Load, broker: Broker | undefined, draft: OfferAskDraft): { load: Load; reply: string } {
  if (draft.category === "rate") return { load, reply: RATE_REDIRECT_REPLY };
  const b = broker ?? ({ contact: "Broker", company: load.source } as Broker);
  const REPLY: Record<Exclude<InstructionCategory, "rate">, string> = {
    detention: `${b.company} confirmed detention pay kicks in after 2 free hours.`,
    schedule: `${b.company} can flex the pickup window if it helps lock this in.`,
    payment: `${b.company} can offer quick pay on this load for a small fee.`,
    general: `${b.company} responded. Nothing here changes what's shown on this card.`,
  };
  return { load, reply: REPLY[draft.category] };
}

// ---------- Incidents: the AI handling breakdowns, accidents, delays and weather like a real dispatcher would ----------

const SHOPS = ["Rush Truck Center", "TA Truck Service", "Love's Truck Care", "Speedco", "Freightliner Service"];

export interface IncidentContext {
  load?: Load;
  brokerName?: string;
  truck?: Truck;
  /** The closest empty truck in the fleet, if any — the fallback plan when a repair runs long. */
  backupTruck?: Truck;
  backupMiles?: number;
}

/** Where the truck is, in words: between the lane's cities while loaded, near the pickup before, or its last city. */
function incidentWhere(ctx: IncidentContext): string {
  const { load, truck } = ctx;
  if (load?.stage === "in_transit") return `between ${load.lane.origin} and ${load.lane.destination}`;
  if (load && (load.stage === "dispatched" || load.stage === "at_pickup")) return `outside ${load.lane.origin}, ${load.lane.originState}`;
  return truck ? `near ${truck.currentCity}, ${truck.currentState}` : "on the route";
}

/** The plan a good dispatcher would work, with the specifics filled in: who to call, what was found, what changed. */
function incidentPlan(type: IncidentType, ctx: IncidentContext): IncidentStep[] {
  const broker = ctx.brokerName ?? "the broker";
  const where = incidentWhere(ctx);
  const onLoad = !!ctx.load && ctx.load.stage !== "delivered";
  const steps: Omit<IncidentStep, "status">[] = [];

  if (type === "breakdown") {
    const shop = pick(SHOPS);
    const quote = randInt(9, 19) * 100 + randInt(0, 9) * 10;
    const delayHrs = randInt(3, 5);
    steps.push({ label: "Driver safe, truck located", detail: `Pulled over ${where} · hazards on, triangles out` });
    steps.push({ label: "Found roadside repair", detail: `${shop} · mobile mechanic ${randInt(6, 22)} mi away, there in ${randInt(35, 60)} min` });
    if (onLoad) steps.push({ label: `Told ${broker} and the receiver`, detail: `New ETA +${delayHrs} hrs · receiver moved the appointment, no penalty` });
    if (onLoad && ctx.backupTruck) {
      steps.push({ label: "Lined up a backup truck", detail: `${ctx.backupTruck.unitNumber} is empty ${ctx.backupMiles ?? randInt(25, 60)} mi away and can relay the load if the repair runs long` });
    }
    steps.push({ label: `Approve the $${quote.toLocaleString()} repair`, detail: `${shop}'s quote is over the $750 the AI can approve on its own`, owner: "human" });
    steps.push({ label: "Repaired and rolling again", detail: onLoad ? `${broker} and the receiver have the final ETA` : "Truck back in service" });
  } else if (type === "accident") {
    steps.push({ label: "Driver checked on", detail: "A Backroute safety specialist is on the line with the driver" });
    steps.push({ label: "Insurance notified", detail: "Claim opened, photos and the police report number requested from the driver" });
    steps.push({ label: "Tow and inspection arranged", detail: `Tow ${randInt(20, 50)} min out, inspection booked at ${pick(SHOPS)}` });
    if (onLoad) steps.push({ label: `Told ${broker}`, detail: "Recovery plan for the freight agreed, delivery window reopened" });
  } else if (type === "delay") {
    const late = randInt(1, 3);
    if (onLoad) steps.push({ label: `Told ${broker} the new ETA`, detail: `Running about ${late} hr${late === 1 ? "" : "s"} late · updated before the appointment, not after` });
    steps.push({ label: "Receiver can take it late", detail: "Appointment moved, no reschedule fee" });
    steps.push({ label: "Next load still on plan", detail: "Pickup window for the next load still fits after the new ETA" });
  } else {
    const detour = randInt(18, 64);
    steps.push({ label: "Checked road conditions", detail: `Storm warning and closures ahead ${where}` });
    steps.push({ label: "Rerouted around the weather", detail: `+${detour} mi, avoids the closure and stays within hours of service` });
    if (onLoad) steps.push({ label: `Told ${broker} and the receiver`, detail: "Weather delay noted, ETA updated, no penalty" });
  }
  return steps.map((s) => ({ ...s, owner: s.owner ?? "ai", status: "pending" as const }));
}

const INCIDENT_LABEL: Record<IncidentType, string> = {
  breakdown: "Breakdown",
  accident: "Accident",
  delay: "Delay",
  weather: "Weather",
};

export function createIncident(driverId: string, carrierId: string, truckId: string, loadId: string | null, type: IncidentType, note: string, ctx: IncidentContext = {}): Incident {
  return {
    id: uid("incident"),
    driverId,
    carrierId,
    truckId,
    loadId,
    type,
    note,
    createdAt: new Date().toISOString(),
    status: "active",
    steps: incidentPlan(type, ctx),
    humanNotified: type === "accident",
  };
}

export function incidentOpenedEvent(incident: Incident, truck: Truck | undefined): ActivityEvent {
  const base = incident.note || "AI dispatcher is handling it now.";
  return mkEvent(
    incident.carrierId,
    incident.loadId ?? undefined,
    "incident",
    `${INCIDENT_LABEL[incident.type]} reported${truck ? `: ${truck.unitNumber}` : ""}`,
    incident.humanNotified ? `${base} A live safety specialist has also been notified.` : base,
    "warning",
  );
}

/** Advance one incident by one step per tick, like a dispatcher working a checklist. */
export function advanceIncident(incident: Incident): { incident: Incident; event?: ActivityEvent } {
  const nextStepIndex = incident.steps.findIndex((s) => s.status === "pending");
  if (nextStepIndex === -1) {
    if (incident.status === "resolved") return { incident };
    const resolved: Incident = { ...incident, status: "resolved" };
    return {
      incident: resolved,
      event: mkEvent(incident.carrierId, incident.loadId ?? undefined, "incident", `${INCIDENT_LABEL[incident.type]} resolved`, "Driver and load back on plan.", "success"),
    };
  }

  // A step only a person can sign off on (a repair bill over the auto-approve limit) waits for that person.
  if (incident.steps[nextStepIndex].owner === "human") return { incident };
  const steps = incident.steps.map((s, i) => (i === nextStepIndex ? { ...s, status: "done" as const, timestamp: new Date().toISOString() } : s));
  const updated: Incident = { ...incident, steps };
  const step = steps[nextStepIndex];
  return {
    incident: updated,
    event: mkEvent(incident.carrierId, incident.loadId ?? undefined, "incident", `AI: ${step.label}`, step.detail ?? `${INCIDENT_LABEL[incident.type]} · in progress`, "info"),
  };
}
