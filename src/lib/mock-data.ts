import { createRng } from "./utils";
import type {
  ActivityEvent,
  Broker,
  Carrier,
  Driver,
  DriverMessage,
  EquipmentType,
  Escalation,
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

const DRIVER_ROSTER: { name: string; phone: string; cdl: string }[] = [
  { name: "Marcus Bell", phone: "(214) 555-0148", cdl: "CDL-A TX 88213" },
  { name: "Yolanda Reyes", phone: "(469) 555-0172", cdl: "CDL-A TX 77102" },
  { name: "Corey Franklin", phone: "(214) 555-0195", cdl: "CDL-A TX 65401" },
  { name: "Ava Whitmore", phone: "(972) 555-0163", cdl: "CDL-A TX 71234" },
  { name: "Deshawn Price", phone: "(214) 555-0187", cdl: "CDL-A TX 69022" },
  { name: "Nina Castillo", phone: "(469) 555-0129", cdl: "CDL-A TX 73310" },
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

function scoreLoad(rate: number, miles: number, deadheadMiles: number, fuelCost: number, tollCost: number) {
  const deadheadCost = deadheadMiles * 0.68;
  const netProfit = Math.round(rate - fuelCost - tollCost - deadheadCost);
  const rpm = Math.round((rate / miles) * 100) / 100;
  return { netProfit, rpm };
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
    resolvedRate: number | null;
    stage: LoadStage;
    createdAtOffset: number;
    pickupLabel: string;
    includeCall: boolean;
  },
): { messages: NegotiationMessage[]; calls: VoiceCall[] } {
  const { broker, lane, listedRate, targetRate, resolvedRate, createdAtOffset, pickupLabel, includeCall } = opts;
  const messages: NegotiationMessage[] = [];
  const calls: VoiceCall[] = [];
  let t = createdAtOffset;
  let round = 0;
  const maxRounds = resolvedRate ? rng.int(2, 3) : rng.int(1, 2);
  const finalAmt = resolvedRate ?? targetRate;

  messages.push({
    id: rng.id("msg"),
    channel: "email",
    direction: "outbound",
    from: "Backroute AI",
    timestamp: iso(t),
    content: rng.pick(EMAIL_OPENERS)(lane.origin, lane.destination, lane.miles, pickupLabel),
  });
  t += rng.int(2, 9);

  const brokerOpen = Math.round(listedRate * rng.float(0.88, 0.97));
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

  for (round = 0; round < maxRounds; round++) {
    const progress = (round + 1) / (maxRounds + 1);
    const aiAsk = Math.round(brokerOpen + (finalAmt - brokerOpen) * Math.min(1, progress + 0.25));
    messages.push({
      id: rng.id("msg"),
      channel: round === 0 ? "email" : "sms",
      direction: "outbound",
      from: "Backroute AI",
      timestamp: iso(t),
      content: rng.pick(EMAIL_COUNTERS)(aiAsk),
      offerAmount: aiAsk,
    });
    t += rng.int(2, 11);

    if (round < maxRounds - 1) {
      const brokerCounter = Math.round(brokerOpen + (finalAmt - brokerOpen) * progress);
      messages.push({
        id: rng.id("msg"),
        channel: "sms",
        direction: "inbound",
        from: broker.contact,
        timestamp: iso(t),
        content: rng.pick(BROKER_REPLIES_LOW)(brokerCounter),
        offerAmount: brokerCounter,
      });
      t += rng.int(3, 12);
    }
  }

  if (includeCall) {
    const callStart = t;
    const transcript: CallTranscriptSeed = [
      { speaker: "ai", text: rng.pick(CALL_OPENERS)(broker.contact.split(" ")[0], lane.origin, lane.destination) },
      { speaker: "broker", text: rng.pick(CALL_BROKER_STALLS) },
      { speaker: "ai", text: rng.pick(CALL_AI_HOLDS)(Math.round(finalAmt * 0.98)) },
      { speaker: "broker", text: rng.pick(CALL_BROKER_CHECKS) },
      { speaker: "ai", text: rng.pick(CALL_AI_CLOSES)(finalAmt) },
      { speaker: "broker", text: rng.pick(CALL_BROKER_CONFIRMS) },
    ];
    calls.push({
      id: rng.id("call"),
      status: "completed",
      startedAt: iso(callStart),
      durationSec: rng.int(95, 260),
      transcript,
      outcome: resolvedRate ? `Booked at $${finalAmt.toLocaleString()}` : "Holding for confirmation",
    });
    t += 4;
  }

  if (resolvedRate) {
    messages.push({
      id: rng.id("msg"),
      channel: includeCall ? "sms" : "email",
      direction: "inbound",
      from: broker.contact,
      timestamp: iso(t),
      content: rng.pick(BROKER_ACCEPTS)(resolvedRate),
      offerAmount: resolvedRate,
    });
  } else if (!includeCall) {
    messages.push({
      id: rng.id("msg"),
      channel: "sms",
      direction: "outbound",
      from: "Backroute AI",
      timestamp: iso(t),
      content: rng.pick(SMS_NUDGES),
    });
  }

  return { messages, calls };
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
  const listedRate = Math.round(marketRate * pct(rng, 0.86, 0.96));
  const targetRate = Math.round(marketRate * pct(rng, 0.98, 1.05));
  const deadheadMiles = rng.int(0, 85);
  const { fuelCost, tollCost } = costsForLane(rng, lane.miles, deadheadMiles);

  const resolvedStages: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"];
  const isResolved = resolvedStages.includes(spec.stage);
  const bookedRate = isResolved ? Math.round(targetRate * pct(rng, 0.97, 1.06)) : null;

  const pickupOffsetDays = rng.int(0, 2);
  const pickupLabel = pickupOffsetDays === 0 ? "today" : pickupOffsetDays === 1 ? "tomorrow" : "in 2 days";
  const ref = `BR-${10000 + refCounter}`;

  const includeCall = rng.bool(0.45) && spec.stage !== "sourced" && spec.stage !== "scoring";
  const { messages, calls } =
    spec.stage === "sourced" || spec.stage === "scoring"
      ? { messages: [], calls: [] }
      : buildNegotiationThread(rng, {
          broker,
          lane,
          listedRate,
          targetRate,
          resolvedRate: isResolved ? bookedRate : null,
          stage: spec.stage,
          createdAtOffset: spec.createdOffset,
          pickupLabel,
          includeCall,
        });

  const finalRate = bookedRate ?? targetRate;
  const { netProfit, rpm } = scoreLoad(finalRate, lane.miles, deadheadMiles, fuelCost, tollCost);

  const progressByStage: Record<LoadStage, number> = {
    sourced: 5, scoring: 12, negotiating: 28, rate_confirmed: 42, booked: 52,
    dispatched: 62, at_pickup: 70, in_transit: 82, at_delivery: 93, delivered: 100,
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
    netProfit,
    rpm,
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

  const trucks: Truck[] = DRIVER_ROSTER.map((d, i) => ({
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
    odometer: rng.int(80000, 340000),
  }));
  trucks[0].id = "truck-marcus";
  trucks[0].driverId = PRIMARY_DRIVER_ID;

  const drivers: Driver[] = DRIVER_ROSTER.map((d, i) => ({
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
  }));

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
      reason: "Broker requesting rate 9% below carrier floor — needs human approval to accept or walk.",
      createdAt: iso(-18),
      status: "open",
    },
    {
      id: rng.id("esc"),
      loadId: loads.find((l) => l.stage === "in_transit")?.id ?? loads[10].id,
      carrierId: PRIMARY_CARRIER_ID,
      reason: "Detention at receiver exceeding 2 hours — approve detention invoice to shipper.",
      createdAt: iso(-46),
      status: "open",
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

  return { carriers, brokers, trucks, drivers, loads, activity, escalations, driverMessages };
}
