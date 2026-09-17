import { createRng } from "./utils";
import { computeEconomics, computeLoadScore } from "./scoring";
import type {
  ActivityEvent,
  Broker,
  Carrier,
  Driver,
  DriverMessage,
  EquipmentType,
  Escalation,
  Incident,
  Lane,
  Load,
  LoadDocument,
  LoadStage,
  NegotiationMessage,
  Truck,
  VoiceCall,
} from "./types";

export const PRIMARY_CARRIER_ID = "carrier-titan";
export const PRIMARY_DRIVER_ID = "driver-marcus-bell";

const BASE_TIME = new Date("2026-09-16T14:00:00Z").getTime();
const iso = (offsetMin: number) => new Date(BASE_TIME + offsetMin * 60_000).toISOString();

// ---------- Reference data ----------

const BROKERAGES: { company: string; contact: string; tier: Broker["tier"] }[] = [
  { company: "Redline Logistics", contact: "Dana Whitfield", tier: "preferred" },
  { company: "Summit Ridge Brokerage", contact: "Marcus Cole", tier: "preferred" },
  { company: "Coastal Freight Partners", contact: "Priya Anand", tier: "standard" },
  { company: "Ironhide Transport Solutions", contact: "Bryce Tolliver", tier: "standard" },
  { company: "Meridian Freight Services", contact: "Sarah Nakamura", tier: "preferred" },
  { company: "Crossgate Brokerage Co.", contact: "Luis Ferreira", tier: "watch" },
  { company: "Pinnacle Transport Group", contact: "Hannah Voss", tier: "standard" },
  { company: "Northbound Logistics", contact: "Wes Aldrich", tier: "preferred" },
  { company: "Fairlane Freight", contact: "Camille Duarte", tier: "standard" },
  { company: "Anchor Point Brokerage", contact: "Trevor Simms", tier: "watch" },
  { company: "Cascade Logistics Partners", contact: "Renee Okafor", tier: "preferred" },
  { company: "Vantage Freight Exchange", contact: "Jordan Michaud", tier: "standard" },
];

export const LANES: Lane[] = [
  { origin: "Dallas", originState: "TX", destination: "Atlanta", destState: "GA", miles: 781, marketRpm: 2.41 },
  { origin: "Chicago", originState: "IL", destination: "Memphis", destState: "TN", miles: 530, marketRpm: 2.28 },
  { origin: "Los Angeles", originState: "CA", destination: "Phoenix", destState: "AZ", miles: 372, marketRpm: 2.65 },
  { origin: "Columbus", originState: "OH", destination: "Newark", destState: "NJ", miles: 538, marketRpm: 2.52 },
  { origin: "Houston", originState: "TX", destination: "Oklahoma City", destState: "OK", miles: 419, marketRpm: 2.19 },
  { origin: "Charlotte", originState: "NC", destination: "Orlando", destState: "FL", miles: 583, marketRpm: 2.34 },
  { origin: "Denver", originState: "CO", destination: "Salt Lake City", destState: "UT", miles: 525, marketRpm: 2.47 },
  { origin: "Kansas City", originState: "MO", destination: "Indianapolis", destState: "IN", miles: 488, marketRpm: 2.22 },
  { origin: "Atlanta", originState: "GA", destination: "Nashville", destState: "TN", miles: 249, marketRpm: 2.58 },
  { origin: "Phoenix", originState: "AZ", destination: "Dallas", destState: "TX", miles: 887, marketRpm: 2.31 },
  { origin: "Seattle", originState: "WA", destination: "Portland", destState: "OR", miles: 174, marketRpm: 2.9 },
  { origin: "Memphis", originState: "TN", destination: "Chicago", destState: "IL", miles: 530, marketRpm: 2.26 },
  { origin: "Newark", originState: "NJ", destination: "Columbus", destState: "OH", miles: 538, marketRpm: 2.4 },
  { origin: "Nashville", originState: "TN", destination: "Dallas", destState: "TX", miles: 660, marketRpm: 2.35 },
  { origin: "Indianapolis", originState: "IN", destination: "Kansas City", destState: "MO", miles: 488, marketRpm: 2.2 },
  { origin: "Orlando", originState: "FL", destination: "Charlotte", destState: "NC", miles: 583, marketRpm: 2.29 },
  { origin: "Salt Lake City", originState: "UT", destination: "Denver", destState: "CO", miles: 525, marketRpm: 2.44 },
  { origin: "Oklahoma City", originState: "OK", destination: "Houston", destState: "TX", miles: 419, marketRpm: 2.15 },
];

export const EQUIPMENT: EquipmentType[] = ["Dry Van", "Reefer", "Flatbed"];

const DRIVER_ROSTER: { name: string; phone: string; cdl: string; homeBase: string; homeTimeTarget: string }[] = [
  { name: "Marcus Bell", phone: "(214) 555-0148", cdl: "CDL-A TX 88213", homeBase: "Dallas, TX", homeTimeTarget: "Home by Friday" },
  { name: "Yolanda Reyes", phone: "(469) 555-0172", cdl: "CDL-A TX 77102", homeBase: "Fort Worth, TX", homeTimeTarget: "Home by Saturday" },
  { name: "Corey Franklin", phone: "(214) 555-0195", cdl: "CDL-A TX 65401", homeBase: "Dallas, TX", homeTimeTarget: "No preference set" },
  { name: "Ava Whitmore", phone: "(972) 555-0163", cdl: "CDL-A TX 71234", homeBase: "Plano, TX", homeTimeTarget: "Home by Sunday" },
  { name: "Deshawn Price", phone: "(214) 555-0187", cdl: "CDL-A TX 69022", homeBase: "Arlington, TX", homeTimeTarget: "No preference set" },
  { name: "Nina Castillo", phone: "(469) 555-0129", cdl: "CDL-A TX 73310", homeBase: "Irving, TX", homeTimeTarget: "Home by Friday" },
];

const CARRIER_PREFIXES = [
  "Redhawk", "Silver State", "Bluepoint", "Ironclad", "Lonestar", "Cascade",
  "Frontier", "Blackwood", "Granite", "Coastal Line", "Pioneer", "Northbound",
  "Steel River", "Copper Trail", "Highline", "Ridgeback", "Timberline",
  "Crosswind", "Amber Route", "Sundown", "Prairie Gold", "Deep South",
  "Great Plains", "Harborline", "Westgate", "Cedarline",
];
const CARRIER_SUFFIXES = ["Trucking", "Freight", "Logistics", "Carriers", "Transport", "Haulers"];
const US_CITY_PAIRS: [string, string][] = [
  ["Dallas", "TX"], ["Atlanta", "GA"], ["Chicago", "IL"], ["Memphis", "TN"], ["Phoenix", "AZ"],
  ["Columbus", "OH"], ["Houston", "TX"], ["Charlotte", "NC"], ["Denver", "CO"], ["Kansas City", "MO"],
  ["Nashville", "TN"], ["Seattle", "WA"], ["Newark", "NJ"], ["Indianapolis", "IN"], ["Orlando", "FL"],
];

// ---------- Helpers ----------

function pct(rng: ReturnType<typeof createRng>, min: number, max: number, decimals = 1) {
  return rng.float(min, max, decimals);
}

function buildBrokers(rng: ReturnType<typeof createRng>): Broker[] {
  return BROKERAGES.map((b, i) => ({
    id: `broker-${i + 1}`,
    company: b.company,
    contact: b.contact,
    phone: `(${rng.int(200, 989)}) 555-${rng.int(1000, 9999).toString().slice(0, 4)}`,
    email: `${b.contact.split(" ")[0].toLowerCase()}@${b.company.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
    reliability: b.tier === "preferred" ? rng.int(88, 98) : b.tier === "standard" ? rng.int(70, 87) : rng.int(45, 69),
    avgResponseMins: b.tier === "preferred" ? rng.int(3, 12) : b.tier === "standard" ? rng.int(10, 30) : rng.int(25, 70),
    loadsBooked: rng.int(14, 240),
    onTimePct: rng.int(82, 99),
    avgRateVariancePct: pct(rng, -6, 9),
    tier: b.tier,
    authorityVerified: b.tier === "watch" ? rng.bool(0.7) : true,
    fraudRisk: b.tier === "preferred" ? "low" : b.tier === "standard" ? (rng.bool(0.85) ? "low" : "medium") : rng.pick(["medium", "high"] as const),
  }));
}

function buildLightweightCarriers(rng: ReturnType<typeof createRng>, count: number): Carrier[] {
  const out: Carrier[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let name = "";
    do {
      name = `${rng.pick(CARRIER_PREFIXES)} ${rng.pick(CARRIER_SUFFIXES)}`;
    } while (used.has(name));
    used.add(name);
    const trucks = rng.pick([1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 14]);
    const plan: Carrier["plan"] = trucks <= 1 ? "Starter" : trucks <= 5 ? "Growth" : "Fleet";
    const planFee = plan === "Starter" ? 99 : plan === "Growth" ? 499 : 999;
    const [city, state] = rng.pick(US_CITY_PAIRS);
    const gmvPerTruck = rng.int(17500, 24500);
    const gmvMonth = trucks * gmvPerTruck;
    out.push({
      id: `carrier-${i + 1}`,
      name,
      mc: `MC-${rng.int(300000, 999999)}`,
      dot: `DOT-${rng.int(1000000, 3999999)}`,
      plan,
      mrr: planFee,
      trucks,
      healthScore: rng.int(58, 99),
      joinedAt: iso(-rng.int(20, 400) * 1440),
      city,
      state,
      takeRateRevenue: Math.round(gmvMonth * 0.02),
      gmvMonth,
      avgSavingsPerTruck: rng.int(420, 1180),
    });
  }
  return out;
}

function costsForLane(rng: ReturnType<typeof createRng>, miles: number, deadheadMiles: number) {
  const mpg = 6.4;
  const dieselPrice = 3.89;
  const fuelCost = Math.round(((miles + deadheadMiles) / mpg) * dieselPrice);
  const tollCost = rng.int(0, 145);
  return { fuelCost, tollCost };
}

const EMAIL_OPENERS = [
  (o: string, d: string, miles: number, pick: string) =>
    `Hi — saw your ${o} to ${d} (${miles} mi) posted for ${pick} pickup. We have a truck free in the area. What's the best you can do on rate?`,
  (o: string, d: string, miles: number, pick: string) =>
    `Following up on the ${o}–${d} load, ${pick} pickup. We can cover it today. Can you move on the posted rate?`,
];
const EMAIL_COUNTERS = [
  (amt: number) => `We can do this one at $${amt.toLocaleString()} all-in, no accessorials. Truck can be there within the appointment window.`,
  (amt: number) => `$${amt.toLocaleString()} works on our end and we can hold that rate — need confirmation in the next hour to lock the truck.`,
  (amt: number) => `Closest we can get is $${amt.toLocaleString()}. Truck is clean, on-time history is 98%+, empty and ready to roll.`,
];
const EMAIL_CONCEDE = [
  (amt: number) => `We can come down to $${amt.toLocaleString()} to get this locked in today.`,
  (amt: number) => `Alright, we can do $${amt.toLocaleString()} if that gets us confirmed now.`,
  (amt: number) => `We'll meet you closer — $${amt.toLocaleString()} works if we can lock the truck now.`,
];
const BROKER_REPLIES_LOW = [
  (amt: number) => `Best I can do right now is $${amt.toLocaleString()}. Shipper is firm on the budget.`,
  (amt: number) => `I hear you, but I'm capped at $${amt.toLocaleString()} on this one.`,
  (amt: number) => `Let me check with the shipper — can offer $${amt.toLocaleString()} for now.`,
];
const BROKER_ACCEPTS = [
  (amt: number) => `Alright, you got it — $${amt.toLocaleString()} all-in. Sending the rate con over now.`,
  (amt: number) => `Deal. $${amt.toLocaleString()}, locking the truck. Rate confirmation on its way.`,
  (amt: number) => `Works for me at $${amt.toLocaleString()}. I'll get the paperwork over shortly.`,
];
const CALL_OPENERS = [
  (name: string, o: string, d: string) => `Hi ${name}, this is Backroute calling on the ${o} to ${d} load — following up on our offer.`,
  (name: string, o: string, d: string) => `Hey ${name}, Backroute here on the ${o}–${d} lane. Wanted to close the loop on rate live.`,
  (name: string, o: string, d: string) => `${name}, thanks for picking up — calling about the ${o} to ${d} load we've been going back and forth on.`,
];
const CALL_BROKER_STALLS = [
  "Yeah, hey — let me pull it up. We're still a bit apart on rate.",
  "Sure, one sec... yeah, shipper's still holding firm on budget.",
  "Hey, good timing. Let me check where we landed — we're close but not quite there.",
];
const CALL_AI_HOLDS = [
  (amt: number) => `Understood. We can commit right now at $${amt.toLocaleString()} and have the truck moving within the hour.`,
  (amt: number) => `I hear you — $${amt.toLocaleString()} is where we can lock this in immediately, truck's empty and close by.`,
  (amt: number) => `We can make $${amt.toLocaleString()} work today if we can get this confirmed now.`,
];
const CALL_BROKER_CHECKS = [
  "Let me check with the shipper real quick... okay, I can make that work.",
  "Give me one minute to confirm... alright, that'll clear.",
  "Hold on, pulling up the shipper's number... yeah, we're good there.",
];
const CALL_AI_CLOSES = [
  (amt: number) => `Great — confirming $${amt.toLocaleString()} all-in. Sending our MC and insurance now, please send the rate confirmation.`,
  (amt: number) => `Perfect, locking in $${amt.toLocaleString()}. I'll get our packet over — go ahead and send the rate con when ready.`,
  (amt: number) => `That works — $${amt.toLocaleString()} confirmed. Sending carrier packet now, we'll be rolling shortly.`,
];
const CALL_BROKER_CONFIRMS = [
  "Sounds good, you're booked. Rate con going out now.",
  "Deal — I'll send the rate confirmation over in a few minutes.",
  "You got it, locking the truck on my end. Paperwork's on its way.",
];
const CALL_BROKER_CHECKS_PENDING = [
  "Let me check with the shipper and call you right back.",
  "I'm not authorized to close at that — give me a few minutes to confirm.",
  "Have to run it by my manager on this one, hang tight.",
];
const CALL_AI_FOLLOWUP = [
  (amt: number) => `Understood — let's hold $${amt.toLocaleString()} for you. Call me back the second you're clear to close.`,
  (amt: number) => `We'll keep $${amt.toLocaleString()} open on our end. Get the sign-off and we'll send the packet right away.`,
  (amt: number) => `$${amt.toLocaleString()} still works for us. Confirm with your shipper and we can lock the truck.`,
];
const CALL_BROKER_PENDING = [
  "Okay, I'll call you back once I hear from the shipper.",
  "Give me a bit — I'll follow up as soon as I know.",
  "Noted, I'll get back to you shortly on that.",
];

const SMS_NUDGES = [
  "Just checking in — still have the truck available if we can get to a number that works.",
  "Any movement on that rate? We're ready to roll as soon as we're locked.",
  "Can hold this truck another 20 min — let me know if we have a deal.",
];

function buildNegotiationThread(
  rng: ReturnType<typeof createRng>,
  opts: {
    broker: Broker;
    lane: Lane;
    listedRate: number;
    targetRate: number;
    isResolved: boolean;
    stage: LoadStage;
    createdAtOffset: number;
    pickupLabel: string;
    includeCall: boolean;
  },
): { messages: NegotiationMessage[]; calls: VoiceCall[]; resolvedRate: number | null } {
  const { broker, lane, listedRate, targetRate, isResolved, createdAtOffset, pickupLabel, includeCall } = opts;
  const messages: NegotiationMessage[] = [];
  const calls: VoiceCall[] = [];
  let t = createdAtOffset;
  let round = 0;
  const maxRounds = isResolved ? rng.int(2, 3) : rng.int(1, 2);

  messages.push({
    id: rng.id("msg"),
    channel: "email",
    direction: "outbound",
    from: "Backroute AI",
    timestamp: iso(t),
    content: rng.pick(EMAIL_OPENERS)(lane.origin, lane.destination, lane.miles, pickupLabel),
  });
  t += rng.int(2, 9);

  // "Listed rate" is what the broker posted the load at — they don't lowball below their own posting.
  // Their opening reply holds close to that number, having given a little ground toward the AI's ask.
  const brokerOpen = Math.round(listedRate + (targetRate - listedRate) * rng.float(0.15, 0.35, 3));
  messages.push({
    id: rng.id("msg"),
    channel: "email",
    direction: "inbound",
    from: broker.contact,
    timestamp: iso(t),
    content: rng.pick(BROKER_REPLIES_LOW)(brokerOpen),
    offerAmount: brokerOpen,
  });
  t += rng.int(3, 14);

  // The AI opens at its best, data-driven ask (target) and gives a little ground on each of its own turns —
  // never below a floor that protects margin — while the broker concedes up from their low opener toward
  // wherever the AI currently stands. Two sides closing the gap, not one side standing still the whole time.
  const aiFloor = Math.round(targetRate * 0.94);
  let aiLast = targetRate;
  let brokerLast = brokerOpen;
  for (round = 0; round < maxRounds; round++) {
    const aiAsk = round === 0 ? targetRate : Math.max(aiFloor, Math.round(aiLast - (aiLast - brokerLast) * 0.15));
    messages.push({
      id: rng.id("msg"),
      channel: round === 0 ? "email" : "sms",
      direction: "outbound",
      from: "Backroute AI",
      timestamp: iso(t),
      content: rng.pick(round === 0 ? EMAIL_COUNTERS : EMAIL_CONCEDE)(aiAsk),
      offerAmount: aiAsk,
    });
    aiLast = aiAsk;
    t += rng.int(2, 11);

    if (round < maxRounds - 1) {
      const brokerCounter = Math.round(brokerLast + (aiAsk - brokerLast) * 0.35);
      messages.push({
        id: rng.id("msg"),
        channel: "sms",
        direction: "inbound",
        from: broker.contact,
        timestamp: iso(t),
        content: rng.pick(BROKER_REPLIES_LOW)(brokerCounter),
        offerAmount: brokerCounter,
      });
      brokerLast = brokerCounter;
      t += rng.int(3, 12);
    }
  }

  // The true booked number, when this load resolves, is exactly wherever the AI's ask last stood — the
  // broker giving in, not some further discount tacked on after they've already agreed to look into that
  // number. Landing below aiLast would contradict the broker's own "okay, I can make that work" a line earlier.
  const finalAmt = isResolved ? aiLast : null;

  if (includeCall) {
    const callStart = t;
    // The call picks up right where the email/SMS thread left off (aiLast) — it never opens on a number
    // that contradicts whatever the AI just said a message ago. Only a resolved call moves past that,
    // closing at the true booked number, which is the natural "let's just lock it in" moment.
    const transcript: CallTranscriptSeed = [
      { speaker: "ai", text: rng.pick(CALL_OPENERS)(broker.contact.split(" ")[0], lane.origin, lane.destination) },
      { speaker: "broker", text: rng.pick(CALL_BROKER_STALLS) },
      { speaker: "ai", text: rng.pick(CALL_AI_HOLDS)(aiLast) },
      ...(finalAmt
        ? [
            { speaker: "broker" as const, text: rng.pick(CALL_BROKER_CHECKS) },
            { speaker: "ai" as const, text: rng.pick(CALL_AI_CLOSES)(finalAmt) },
            { speaker: "broker" as const, text: rng.pick(CALL_BROKER_CONFIRMS) },
          ]
        : [
            { speaker: "broker" as const, text: rng.pick(CALL_BROKER_CHECKS_PENDING) },
            { speaker: "ai" as const, text: rng.pick(CALL_AI_FOLLOWUP)(aiLast) },
            { speaker: "broker" as const, text: rng.pick(CALL_BROKER_PENDING) },
          ]),
    ];
    calls.push({
      id: rng.id("call"),
      status: "completed",
      startedAt: iso(callStart),
      durationSec: rng.int(95, 260),
      transcript,
      outcome: finalAmt ? `Booked at $${finalAmt.toLocaleString()}` : "Holding for confirmation",
    });
    t += 4;
  }

  if (finalAmt && !includeCall) {
    // When there's a call, the call itself closes the deal (its transcript already ends in acceptance) —
    // adding a second, separate "you got it" message here would have the broker agree twice.
    messages.push({
      id: rng.id("msg"),
      channel: "email",
      direction: "inbound",
      from: broker.contact,
      timestamp: iso(t),
      content: rng.pick(BROKER_ACCEPTS)(finalAmt),
      offerAmount: finalAmt,
    });
  } else if (!finalAmt && !includeCall) {
    messages.push({
      id: rng.id("msg"),
      channel: "sms",
      direction: "outbound",
      from: "Backroute AI",
      timestamp: iso(t),
      content: rng.pick(SMS_NUDGES),
    });
  }

  return { messages, calls, resolvedRate: finalAmt };
}

type CallTranscriptSeed = { speaker: "ai" | "broker"; text: string }[];

function buildDocuments(rng: ReturnType<typeof createRng>, stage: LoadStage, ref: string, createdOffset: number): LoadDocument[] {
  const docs: LoadDocument[] = [];
  const order: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"];
  const idx = order.indexOf(stage);
  if (idx >= 0) {
    docs.push({ id: rng.id("doc"), type: "rate_confirmation", name: `RateCon_${ref}.pdf`, generatedAt: iso(createdOffset + 4), status: "verified" });
  }
  if (idx >= 2) {
    docs.push({ id: rng.id("doc"), type: "bol", name: `BOL_${ref}.pdf`, generatedAt: iso(createdOffset + 40), status: "verified" });
  }
  if (idx >= 5) {
    docs.push({ id: rng.id("doc"), type: "pod", name: `POD_${ref}.pdf`, generatedAt: iso(createdOffset + 300), status: stage === "delivered" ? "verified" : "pending" });
  }
  if (stage === "delivered") {
    docs.push({ id: rng.id("doc"), type: "invoice", name: `Invoice_${ref}.pdf`, generatedAt: iso(createdOffset + 320), status: "verified" });
  }
  return docs;
}

interface LoadSpec {
  stage: LoadStage;
  truckId: string | null;
  createdOffset: number;
  isChained?: boolean;
}

function buildLoad(
  rng: ReturnType<typeof createRng>,
  brokers: Broker[],
  spec: LoadSpec,
  refCounter: number,
): Load {
  const broker = rng.pick(brokers);
  const lane = rng.pick(LANES);
  const equipmentType = rng.pick(EQUIPMENT);
  const marketRate = lane.miles * lane.marketRpm;
  // These multiplier ranges are only ~0.1 wide — pct()'s default of 1 decimal place would collapse almost
  // the entire range to a single value (e.g. 0.98–1.05 always rounds to 1.0), regularly making listed/target/
  // booked rate land on the exact same number. Finer decimals keep the intended spread.
  const listedRate = Math.round(marketRate * pct(rng, 0.86, 0.96, 3));
  const targetRate = Math.round(marketRate * pct(rng, 0.98, 1.05, 3));
  const deadheadMiles = rng.int(0, 85);
  const { fuelCost, tollCost } = costsForLane(rng, lane.miles, deadheadMiles);

  const resolvedStages: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"];
  const isResolved = resolvedStages.includes(spec.stage);

  const pickupOffsetDays = rng.int(0, 2);
  const pickupLabel = pickupOffsetDays === 0 ? "today" : pickupOffsetDays === 1 ? "tomorrow" : "in 2 days";
  const ref = `BR-${10000 + refCounter}`;

  const includeCall = rng.bool(0.45) && spec.stage !== "sourced" && spec.stage !== "scoring" && spec.stage !== "offered";
  // bookedRate is never rolled independently — it comes straight out of the thread below, so the number
  // that actually gets booked always matches (or is bounded by) what the AI and broker last said.
  const { messages, calls, resolvedRate: bookedRate } =
    spec.stage === "sourced" || spec.stage === "scoring" || spec.stage === "offered"
      ? { messages: [], calls: [], resolvedRate: null }
      : buildNegotiationThread(rng, {
          broker,
          lane,
          listedRate,
          targetRate,
          isResolved,
          stage: spec.stage,
          createdAtOffset: spec.createdOffset,
          pickupLabel,
          includeCall,
        });

  const finalRate = bookedRate ?? targetRate;
  const { deadheadCost, commission, netProfit, rpm } = computeEconomics(finalRate, lane.miles, deadheadMiles, fuelCost, tollCost);
  const score = computeLoadScore({ rate: finalRate, netProfit, miles: lane.miles, deadheadMiles, rpm, marketRpm: lane.marketRpm, brokerReliability: broker.reliability });

  const progressByStage: Record<LoadStage, number> = {
    sourced: 5, scoring: 12, offered: 16, negotiating: 28, rate_confirmed: 42, booked: 52,
    dispatched: 62, at_pickup: 70, in_transit: 82, at_delivery: 93, delivered: 100, declined: 100,
  };

  return {
    id: rng.id("load"),
    referenceNumber: ref,
    stage: spec.stage,
    source: rng.pick(["DAT One", "Truckstop", "Numeo", "Direct Email", "Loadsmart", "DAT One", "Truckstop"]),
    brokerId: broker.id,
    lane,
    equipmentType,
    weight: rng.int(22000, 44500),
    pickupWindow: `${pickupLabel}, ${rng.int(6, 14)}:00–${rng.int(15, 19)}:00`,
    deliveryWindow: `${rng.int(1, 3)} day transit`,
    listedRate,
    targetRate,
    bookedRate,
    deadheadMiles,
    fuelCost,
    tollCost,
    deadheadCost,
    commission,
    netProfit,
    rpm,
    score,
    carrierId: PRIMARY_CARRIER_ID,
    truckId: spec.truckId,
    messages,
    calls,
    documents: buildDocuments(rng, spec.stage, ref, spec.createdOffset),
    createdAt: iso(spec.createdOffset),
    updatedAt: iso(spec.createdOffset + rng.int(5, 90)),
    isChained: !!spec.isChained,
    aiConfidence: rng.int(78, 99),
    ticksInStage: 0,
    progressPct: progressByStage[spec.stage],
  };
}

// ---------- World builder ----------

export interface World {
  carriers: Carrier[];
  brokers: Broker[];
  trucks: Truck[];
  drivers: Driver[];
  loads: Load[];
  activity: ActivityEvent[];
  escalations: Escalation[];
  driverMessages: DriverMessage[];
  incidents: Incident[];
}

export function generateWorld(seed = 20260916): World {
  const rng = createRng(seed);
  const brokers = buildBrokers(rng);

  const primaryCarrier: Carrier = {
    id: PRIMARY_CARRIER_ID,
    name: "Titan Freight LLC",
    mc: "MC-548213",
    dot: "DOT-2871940",
    plan: "Growth",
    mrr: 499,
    trucks: 6,
    healthScore: 94,
    joinedAt: iso(-95 * 1440),
    city: "Dallas",
    state: "TX",
    takeRateRevenue: 2640,
    gmvMonth: 132000,
    avgSavingsPerTruck: 961,
    detailed: true,
  };

  const otherCarriers = buildLightweightCarriers(rng, 27);
  const carriers = [primaryCarrier, ...otherCarriers];

  const trucks: Truck[] = DRIVER_ROSTER.map((d, i) => {
    const odometer = rng.int(80000, 340000);
    const serviceIntervalMiles = 25000;
    return {
      id: `truck-${i + 1}`,
      unitNumber: `T-${104 + i}`,
      driverId: `driver-${i + 1}`,
      carrierId: PRIMARY_CARRIER_ID,
      equipmentType: rng.pick(EQUIPMENT),
      status: "available",
      currentCity: rng.pick(US_CITY_PAIRS)[0],
      currentState: "TX",
      homeBase: "Dallas, TX",
      currentLoadId: null,
      nextLoadId: null,
      mpg: pct(rng, 6.1, 7.2),
      odometer,
      lastServiceMiles: odometer - rng.int(1500, serviceIntervalMiles + 2000),
      serviceIntervalMiles,
      nextInspectionDue: iso(rng.int(-10, 75) * 1440),
    };
  });
  trucks[0].id = "truck-marcus";
  trucks[0].driverId = PRIMARY_DRIVER_ID;

  const drivers: Driver[] = DRIVER_ROSTER.map((d, i) => {
    const payType: Driver["payType"] = rng.bool(0.6) ? "percentage" : "per_mile";
    return {
      id: i === 0 ? PRIMARY_DRIVER_ID : `driver-${i + 1}`,
      name: d.name,
      phone: d.phone,
      email: `${d.name.toLowerCase().replace(/\s+/g, ".")}@titanfreight.com`,
      truckId: trucks[i].id,
      carrierId: PRIMARY_CARRIER_ID,
      hosStatus: rng.pick(["driving", "driving", "on_duty", "off_duty", "sleeper"]),
      hoursRemaining: pct(rng, 2.5, 10.5),
      cdl: d.cdl,
      rating: pct(rng, 4.6, 5.0, 1),
      hireDate: iso(-rng.int(60, 900) * 1440),
      homeBase: d.homeBase,
      homeTimeTarget: d.homeTimeTarget,
      payType,
      payRate: payType === "percentage" ? pct(rng, 0.25, 0.32, 2) : pct(rng, 0.58, 0.68, 2),
    };
  });

  const specs: LoadSpec[] = [
    { stage: "sourced", truckId: null, createdOffset: -8 },
    { stage: "sourced", truckId: null, createdOffset: -4 },
    { stage: "scoring", truckId: null, createdOffset: -22 },
    { stage: "negotiating", truckId: null, createdOffset: -55 },
    { stage: "negotiating", truckId: null, createdOffset: -95 },
    { stage: "negotiating", truckId: trucks[3].id, createdOffset: -40, isChained: true },
    { stage: "rate_confirmed", truckId: null, createdOffset: -130 },
    { stage: "booked", truckId: trucks[1].id, createdOffset: -180 },
    { stage: "booked", truckId: trucks[4].id, createdOffset: -160 },
    { stage: "dispatched", truckId: trucks[2].id, createdOffset: -260 },
    { stage: "in_transit", truckId: trucks[0].id, createdOffset: -420 },
    { stage: "in_transit", truckId: trucks[5].id, createdOffset: -390 },
    { stage: "at_delivery", truckId: trucks[3].id, createdOffset: -600 },
    { stage: "delivered", truckId: trucks[0].id, createdOffset: -1500 },
    { stage: "delivered", truckId: trucks[1].id, createdOffset: -2100 },
    { stage: "delivered", truckId: trucks[2].id, createdOffset: -2800 },
    { stage: "delivered", truckId: trucks[4].id, createdOffset: -3400 },
  ];

  const loads = specs.map((spec, i) => buildLoad(rng, brokers, spec, i));

  loads.forEach((load) => {
    if (!load.truckId) return;
    const truck = trucks.find((t) => t.id === load.truckId);
    if (!truck) return;
    if (["dispatched", "at_pickup", "in_transit", "at_delivery"].includes(load.stage)) {
      truck.status = "on_load";
      truck.currentLoadId = load.id;
      truck.currentCity = load.lane.origin;
      truck.currentState = load.lane.originState;
    } else if (load.stage === "negotiating" && load.isChained) {
      truck.nextLoadId = load.id;
    } else if (load.stage === "booked") {
      truck.status = "on_load";
      truck.currentLoadId = load.id;
    }
  });

  const escalations: Escalation[] = [
    {
      id: rng.id("esc"),
      loadId: loads.find((l) => l.stage === "negotiating")?.id ?? loads[3].id,
      carrierId: PRIMARY_CARRIER_ID,
      reason: "Broker requesting rate 9% below carrier floor — needs a judgment call on accept or walk.",
      createdAt: iso(-18),
      status: "open",
      complexity: "critical",
    },
    {
      id: rng.id("esc"),
      loadId: loads.find((l) => l.stage === "in_transit")?.id ?? loads[10].id,
      carrierId: PRIMARY_CARRIER_ID,
      reason: "Detention at receiver exceeding 2 hours — invoice ready to send.",
      createdAt: iso(-46),
      status: "open",
      complexity: "routine",
      recommendedAction: "approve",
      recommendedLabel: "Approve — send detention invoice",
    },
  ];

  const activity: ActivityEvent[] = [
    { id: rng.id("act"), timestamp: iso(-4), type: "load_sourced", message: "New load sourced from DAT One", detail: `Dallas, TX → Atlanta, GA · $${loads[1]?.listedRate ?? 1850}`, loadId: loads[1]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info" },
    { id: rng.id("act"), timestamp: iso(-11), type: "negotiation_sms", channel: "sms", message: "AI countered broker via SMS", detail: "Meridian Freight Services · Countered at $2,140", loadId: loads[4]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info" },
    { id: rng.id("act"), timestamp: iso(-26), type: "call_completed", channel: "voice", message: "Voice call closed — rate locked", detail: "Cascade Logistics Partners · $2,310 all-in", loadId: loads[6]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "success" },
    { id: rng.id("act"), timestamp: iso(-33), type: "tms_synced", message: "Load synced to TMS", detail: `Reference ${loads[7]?.referenceNumber}`, loadId: loads[7]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "success" },
    { id: rng.id("act"), timestamp: iso(-58), type: "check_call", message: "Automated check call completed", detail: "Truck T-107 · On schedule, ETA 6:40 PM", loadId: loads[9]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info" },
    { id: rng.id("act"), timestamp: iso(-72), type: "chained", message: "Next load pre-negotiated before delivery", detail: "Truck T-107 · 0 deadhead miles projected", loadId: loads[5]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "success" },
    { id: rng.id("act"), timestamp: iso(-95), type: "escalation", message: "Escalated to carrier for approval", detail: escalations[0].reason, loadId: escalations[0].loadId, carrierId: PRIMARY_CARRIER_ID, severity: "warning" },
    { id: rng.id("act"), timestamp: iso(-140), type: "document_captured", message: "POD captured and verified", detail: `Invoice generated · ${loads[13]?.referenceNumber}`, loadId: loads[13]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "success" },
  ];
  activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const driverMessages: DriverMessage[] = [
    { id: rng.id("dm"), driverId: PRIMARY_DRIVER_ID, from: "ai", content: "Morning Marcus — you're loaded and headed to Atlanta. Traffic's clear on I-20, ETA holding at 6:40 PM.", timestamp: iso(-410) },
    { id: rng.id("dm"), driverId: PRIMARY_DRIVER_ID, from: "driver", content: "Sounds good, stopping for fuel in Shreveport.", timestamp: iso(-395) },
    { id: rng.id("dm"), driverId: PRIMARY_DRIVER_ID, from: "ai", content: "Got it, noted. I'm already working your next load out of Atlanta so you won't run empty — will confirm rate shortly.", timestamp: iso(-390) },
    { id: rng.id("dm"), driverId: PRIMARY_DRIVER_ID, from: "ai", content: "Heads up: receiver in Atlanta closes at 6 PM sharp, you're tracking to arrive with room to spare.", timestamp: iso(-60) },
  ];

  return { carriers, brokers, trucks, drivers, loads, activity, escalations, driverMessages, incidents: [] };
}
