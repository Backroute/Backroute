import { EQUIPMENT, LANES } from "./mock-data";
import type {
  ActivityEvent,
  ActivityType,
  Broker,
  CallTranscriptLine,
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

export function createSourcedLoad(brokers: Broker[], carrierId: string, refSeed: number, truckId: string | null, isChained: boolean): Load {
  const broker = pick(brokers);
  const lane = pick(LANES);
  const marketRate = lane.miles * lane.marketRpm;
  const listedRate = Math.round(marketRate * (0.86 + Math.random() * 0.1));
  const targetRate = Math.round(marketRate * (0.98 + Math.random() * 0.07));
  const deadheadMiles = randInt(0, 85);
  const { fuelCost, tollCost } = costsForLane(lane.miles, deadheadMiles);
  const now = new Date().toISOString();

  return {
    id: uid("load"),
    referenceNumber: `BR-${20000 + refSeed}`,
    stage: "sourced",
    source: pick(["DAT One", "Truckstop", "Numeo", "Direct Email", "Loadsmart"]),
    brokerId: broker.id,
    lane,
    equipmentType: pick(EQUIPMENT),
    weight: randInt(22000, 44500),
    pickupWindow: `${pick(["today", "tomorrow"])}, ${randInt(6, 14)}:00–${randInt(15, 19)}:00`,
    deliveryWindow: `${randInt(1, 3)} day transit`,
    listedRate,
    targetRate,
    bookedRate: null,
    deadheadMiles,
    fuelCost,
    tollCost,
    netProfit: null,
    rpm: null,
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
  };
}

const EMAIL_OPEN = (o: string, d: string, miles: number) =>
  `Hi — saw your ${o} to ${d} (${miles} mi) posted. We have a truck available. What's the best you can do on rate?`;
const AI_COUNTER = (amt: number) => `We can commit at $${amt.toLocaleString()} all-in — truck is clean and ready to move within the appointment window.`;
const BROKER_LOW = (amt: number) => `Best I can do right now is $${amt.toLocaleString()}. Shipper's tight on budget this week.`;
const BROKER_ACCEPT = (amt: number) => `Alright, you've got it — $${amt.toLocaleString()} all-in. Sending the rate con over now.`;

const CALL_OPENERS = [
  (name: string, o: string, d: string) => `Hi ${name}, this is Backroute calling on the ${o} to ${d} load.`,
  (name: string, o: string, d: string) => `Hey ${name}, Backroute here on the ${o}–${d} lane — got a minute?`,
  (name: string, o: string, d: string) => `${name}, calling to close the loop on the ${o} to ${d} load.`,
];
const CALL_BROKER_STALLS = [
  "Hey, let me pull it up — we're still a bit apart on rate.",
  "Sure, one sec... yeah, shipper's holding firm on budget.",
  "Good timing — let me check where we landed.",
];
const CALL_AI_HOLDS = [
  (amt: number) => `We can commit right now at $${amt.toLocaleString()} and have the truck moving within the hour.`,
  (amt: number) => `$${amt.toLocaleString()} is where we can lock this in immediately — truck's close by and empty.`,
  (amt: number) => `We can make $${amt.toLocaleString()} work today if we get this confirmed now.`,
];
const CALL_BROKER_CHECKS = [
  "Let me check with the shipper... okay, I can make that work.",
  "Give me a second to confirm... alright, that'll clear.",
  "Hold on... yeah, we're good there.",
];
const CALL_AI_CLOSES = [
  (amt: number) => `Confirming $${amt.toLocaleString()} all-in. Sending MC and insurance now.`,
  (amt: number) => `Locking in $${amt.toLocaleString()}. Sending our packet over now.`,
  (amt: number) => `$${amt.toLocaleString()} confirmed — sending carrier packet, we'll be rolling shortly.`,
];
const CALL_BROKER_CONFIRMS = [
  "You're booked. Rate con going out now.",
  "Deal — sending the rate confirmation over in a few minutes.",
  "Locking the truck on my end. Paperwork's on its way.",
];

interface StepResult {
  load: Load;
  events: ActivityEvent[];
  truckUpdates?: Partial<Truck> & { id: string };
}

const STAGE_PROGRESS: Record<LoadStage, number> = {
  sourced: 4, scoring: 12, negotiating: 30, rate_confirmed: 44, booked: 54,
  dispatched: 64, at_pickup: 72, in_transit: 84, at_delivery: 94, delivered: 100,
};

function mkEvent(carrierId: string, loadId: string, type: ActivityType, message: string, detail: string, severity: ActivityEvent["severity"], channel?: ActivityEvent["channel"]): ActivityEvent {
  return { id: uid("act"), timestamp: new Date().toISOString(), type, message, detail, loadId, carrierId, severity, channel };
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
      if (rounds >= 5 || chance(0.32)) {
        const goVoice = chance(0.4) && !load.calls.length;
        if (goVoice) {
          const finalAmt = Math.round(load.targetRate * (0.97 + Math.random() * 0.05));
          const transcript: CallTranscriptLine[] = [
            { speaker: "ai", text: pick(CALL_OPENERS)(b.contact.split(" ")[0], load.lane.origin, load.lane.destination) },
            { speaker: "broker", text: pick(CALL_BROKER_STALLS) },
            { speaker: "ai", text: pick(CALL_AI_HOLDS)(finalAmt) },
            { speaker: "broker", text: pick(CALL_BROKER_CHECKS) },
            { speaker: "ai", text: pick(CALL_AI_CLOSES)(finalAmt) },
            { speaker: "broker", text: pick(CALL_BROKER_CONFIRMS) },
          ];
          const call: VoiceCall = { id: uid("call"), status: "completed", startedAt: new Date().toISOString(), durationSec: randInt(95, 240), transcript, outcome: `Booked at $${finalAmt.toLocaleString()}` };
          next.calls = [...load.calls, call];
          next.bookedRate = finalAmt;
          next.stage = "rate_confirmed";
          const { fuelCost, tollCost, deadheadMiles, lane } = load;
          next.netProfit = Math.round(finalAmt - fuelCost - tollCost - deadheadMiles * 0.68);
          next.rpm = Math.round((finalAmt / lane.miles) * 100) / 100;
          next.documents = [...load.documents, { id: uid("doc"), type: "rate_confirmation", name: `RateCon_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" }];
          events.push(mkEvent(load.carrierId, load.id, "call_completed", "Voice agent closed the deal by phone", `${b.company} · $${finalAmt.toLocaleString()} all-in`, "success", "voice"));
        } else {
          const finalAmt = Math.round(load.targetRate * (0.96 + Math.random() * 0.06));
          const msg: NegotiationMessage = { id: uid("msg"), channel: "sms", direction: "inbound", from: b.contact, timestamp: new Date().toISOString(), content: BROKER_ACCEPT(finalAmt), offerAmount: finalAmt };
          next.messages = [...load.messages, msg];
          next.bookedRate = finalAmt;
          next.stage = "rate_confirmed";
          const { fuelCost, tollCost, deadheadMiles, lane } = load;
          next.netProfit = Math.round(finalAmt - fuelCost - tollCost - deadheadMiles * 0.68);
          next.rpm = Math.round((finalAmt / lane.miles) * 100) / 100;
          next.documents = [...load.documents, { id: uid("doc"), type: "rate_confirmation", name: `RateCon_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" }];
          events.push(mkEvent(load.carrierId, load.id, "rate_confirmed", "Rate confirmed and validated", `${b.company} · $${finalAmt.toLocaleString()} all-in`, "success", "sms"));
        }
      } else {
        const isAiTurn = rounds % 2 === 0;
        const lastOffer = [...load.messages].reverse().find((m) => m.offerAmount)?.offerAmount ?? load.listedRate;
        const amt = isAiTurn
          ? Math.round(lastOffer + (load.targetRate - lastOffer) * 0.5)
          : Math.round(lastOffer + (load.targetRate - lastOffer) * 0.3);
        const msg: NegotiationMessage = {
          id: uid("msg"), channel: pick(["email", "sms"]), direction: isAiTurn ? "outbound" : "inbound",
          from: isAiTurn ? "Backroute AI" : b.contact, timestamp: new Date().toISOString(),
          content: isAiTurn ? AI_COUNTER(amt) : BROKER_LOW(amt), offerAmount: amt,
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
      events.push(mkEvent(load.carrierId, load.id, "dispatched", "Driver dispatched", `${truck.unitNumber} en route to ${load.lane.origin}`, "info"));
      return { load: next, events, truckUpdates: { id: truck.id, status: "on_load", currentLoadId: load.id } };
    }
    case "dispatched": {
      next.stage = "at_pickup";
      events.push(mkEvent(load.carrierId, load.id, "check_call", "Arrived at pickup", `${load.lane.origin}, ${load.lane.originState}`, "info"));
      break;
    }
    case "at_pickup": {
      next.stage = "in_transit";
      next.documents = [...load.documents, { id: uid("doc"), type: "bol", name: `BOL_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" }];
      events.push(mkEvent(load.carrierId, load.id, "document_captured", "BOL captured and verified", `Loaded ${load.weight.toLocaleString()} lbs · departing ${load.lane.origin}`, "success"));
      break;
    }
    case "in_transit": {
      if (load.ticksInStage < 2 && chance(0.6)) {
        events.push(mkEvent(load.carrierId, load.id, "check_call", "Automated check call", `On schedule · approaching ${load.lane.destination}`, "info"));
        return { load: next, events };
      }
      next.stage = "at_delivery";
      events.push(mkEvent(load.carrierId, load.id, "check_call", "Arrived at delivery", `${load.lane.destination}, ${load.lane.destState}`, "info"));
      break;
    }
    case "at_delivery": {
      next.stage = "delivered";
      next.documents = [
        ...load.documents,
        { id: uid("doc"), type: "pod", name: `POD_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" },
        { id: uid("doc"), type: "invoice", name: `Invoice_${load.referenceNumber}.pdf`, generatedAt: new Date().toISOString(), status: "verified" },
      ];
      events.push(mkEvent(load.carrierId, load.id, "delivered", "Delivered — POD captured, invoice generated", `${load.referenceNumber} · net $${(load.netProfit ?? 0).toLocaleString()}`, "success"));
      if (truck) {
        return { load: next, events, truckUpdates: { id: truck.id, status: "available", currentLoadId: null } };
      }
      break;
    }
    default:
      break;
  }

  next.progressPct = STAGE_PROGRESS[next.stage];
  return { load: next, events };
}

export function shouldChainNextLoad(load: Load, truck: Truck | undefined): boolean {
  return !!truck && load.stage === "in_transit" && !truck.nextLoadId && chance(0.5);
}
