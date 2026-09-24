import { create } from "zustand";
import { DEFAULT_ENABLED_ADDONS } from "./addons";
import { generateWorld, PRIMARY_CARRIER_ID, PRIMARY_DRIVER_ID } from "./mock-data";
import {
  advanceIncident,
  advanceLoad,
  applyNegotiationInstruction,
  autoResolveStaleOffers,
  classifyInstruction,
  confirmLoadStage,
  createIncident,
  createLoadOfferBatch,
  createSourcedLoad,
  draftOfferAsk,
  finishBrokerCall,
  incidentOpenedEvent,
  pickLaneNear,
  pushForBetterRate,
  resolveLoadOffer,
  resolveOfferAsk,
  scriptBrokerCall,
  shouldChainNextLoad,
  type InstructionCategory,
  type OfferAskDraft,
} from "./engine";
import { computeEconomics, computeLoadScore } from "./scoring";
import { nextStop } from "./load-status";
import { dockClock, dockMinutes, detentionFor, formatDockTime } from "./detention";
import { cityCoords, distanceMiles, legMiles, legProgress } from "./trip-geo";
import { bookableBrokers, type BrokerPolicy } from "./broker-policy";
import { homeTimeStatus } from "./home";
import { HOME_TIME_OPTIONS, laneFits, RUN_TYPE_DETAIL, RUN_TYPE_LABEL } from "./run-types";
import { computeDriverPay, payLabel } from "./settlements";
import { brokerCorrects, RATE_CON_FIX_MS, RATE_CON_READ_MS, refusedSummary, reviewRateCon, savedBy } from "./rate-con";
import { pack, type QuickPhrase } from "./lang";
import { weekEarnings } from "./earnings";
import {
  briefCall,
  CALL_GAP_MS,
  driverTakes,
  KIND_LABEL,
  lateCall,
  autoBookedText,
  driverLang,
  inboundCall,
  lateOnThisLoad,
  type EmptyAt,
  type Turn,
  nextLoadCall,
  OWNER_NAME,
  openCall,
  parkingCall,
  quietReason,
  respond,
  RING_MS,
  setupCall,
  stillRelevant,
  textCopyFor,
} from "./dispatch-calls";
import { clamp, formatDuration } from "./utils";
import type {
  ActivityEvent,
  Broker,
  Carrier,
  CarrierMessage,
  DispatchCall,
  DispatchCallKind,
  Driver,
  DriverMessage,
  DriverPrefs,
  HosStatus,
  Lang,
  RateConReview,
  Translations,
  DvirInspection,
  DvirItem,
  Escalation,
  Expense,
  TimeOffRequest,
  Incident,
  IncidentType,
  Lane,
  Load,
  RunType,
  LoadDocument,
  MaintenanceAppointment,
  Truck,
  VoiceCall,
} from "./types";

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const EXPENSE_CATEGORY_LABEL: Record<Expense["category"], string> = {
  lumper: "lumper fee",
  detention: "detention",
  parking: "parking",
  scale: "scale ticket",
  other: "other",
};

/** Promotes a truck's already-chained next load into its current slot the moment it frees up — used both
 *  by the automatic tick (AI-side deliveries, if any ever land there again) and driverConfirmStage (the
 *  only place physical deliveries actually happen now), so "zero empty miles" chaining can't quietly stop
 *  working just because one of its two call sites goes unreachable. */
function promoteChainedLoad(trucks: Truck[], truckId: string, carrierId: string): { trucks: Truck[]; event: ActivityEvent | null } {
  const truck = trucks.find((t) => t.id === truckId);
  if (!truck?.nextLoadId) return { trucks, event: null };
  const chainedId = truck.nextLoadId;
  return {
    trucks: trucks.map((t) => (t.id === truckId ? { ...t, currentLoadId: chainedId, nextLoadId: null } : t)),
    event: {
      id: uid("act"), timestamp: new Date().toISOString(), type: "chained",
      message: "Next load already chained, zero empty miles", detail: `${truck.unitNumber} rolling straight into the next lane`,
      loadId: chainedId, carrierId, severity: "success",
    },
  };
}

/** Auto-pick: take the AI's recommended option from a fresh offer batch and line it up for the truck, the
 *  same as if the driver had tapped "Select this load" on it. */
function autoPickOffer(loads: Load[], trucks: Truck[], offers: Load[], truckId: string): { loads: Load[]; trucks: Truck[]; events: ActivityEvent[] } {
  const best = offers.find((o) => o.recommended) ?? offers.reduce((a, b) => (b.score > a.score ? b : a), offers[0]);
  if (!best?.offerGroupId) return { loads, trucks, events: [] };
  const resolved = resolveLoadOffer(loads, best.offerGroupId, best.id, "ai");
  return {
    loads: resolved.loads,
    trucks: trucks.map((t) => (t.id === truckId && t.currentLoadId ? { ...t, nextLoadId: best.id } : t)),
    events: resolved.events,
  };
}

/** What the AI tells the broker and does in the background at each physical milestone — the calls, emails and
 *  paperwork a human dispatcher would otherwise be making all day. */
function aiMilestoneEvent(load: Load, brokerName: string): ActivityEvent | null {
  const base = { id: uid("act"), timestamp: new Date().toISOString(), loadId: load.id, carrierId: load.carrierId };
  switch (load.stage) {
    case "at_pickup":
      return { ...base, type: "check_call", channel: "email", message: `AI told ${brokerName} the driver checked in`, detail: `${load.referenceNumber} · detention clock running, 2 hrs free`, severity: "info" };
    case "in_transit":
      return { ...base, type: "document_captured", channel: "email", message: `AI sent the BOL to ${brokerName}`, detail: `${load.referenceNumber} · live tracking shared, ETA updates go out automatically`, severity: "success" };
    case "at_delivery":
      return { ...base, type: "check_call", channel: "email", message: `AI told ${brokerName} the driver is at the receiver`, detail: `${load.referenceNumber} · detention clock running, 2 hrs free`, severity: "info" };
    case "delivered":
      return { ...base, type: "document_captured", channel: "email", message: `AI emailed the POD and invoice to ${brokerName}`, detail: `${load.referenceNumber} · payment tracked until it lands`, severity: "success" };
    default:
      return null;
  }
}

/** Puts the AI on the phone with the load's broker; the call plays out live and books the load when it ends. */
function withLiveCall(load: Load, broker: Broker | undefined): { load: Load; event: ActivityEvent } {
  const liveCall = scriptBrokerCall(load, broker);
  return {
    load: { ...load, liveCall },
    event: {
      id: uid("act"), timestamp: liveCall.startedAt, type: "call_started", channel: "voice",
      message: `AI is on the phone with ${broker?.company ?? "the broker"}`, detail: `${load.lane.origin} → ${load.lane.destination} · asking $${liveCall.lines[2].offer?.toLocaleString()}`,
      loadId: load.id, carrierId: load.carrierId, severity: "info",
    },
  };
}

/** Each live call hangs up on its own timer, whichever action or tick started it. */
const scheduledCalls = new Set<string>();
function scheduleCallEnds(loads: Load[], finish: (loadId: string, callId: string) => void) {
  for (const l of loads) {
    const call = l.liveCall;
    if (!call || scheduledCalls.has(call.id)) continue;
    scheduledCalls.add(call.id);
    const remaining = Math.max(0, Date.parse(call.startedAt) + call.durationMs - Date.now());
    setTimeout(() => finish(l.id, call.id), remaining);
  }
}

export const AUTONOMY_LABEL: Record<Autonomy, string> = { ask: "Ask me first", rules: "Within my rules", full: "Full autopilot" };
export const AUTONOMY_DETAIL: Record<Autonomy, string> = {
  ask: "The AI finds, scores and negotiates. You or the driver pick every load.",
  rules: "The AI books on its own when a load makes money, pays your minimum rate and fits home time. The rest wait for a pick.",
  full: "The AI books every truck's next load the moment it finds the best one.",
};

/** Where home time stands for the truck's next load — a dispatcher checks this before booking anything. When it's
 *  tight, or the carrier said home first, the AI only books loads that bring the driver closer to home. */
function homeOptions(driver: Driver | undefined, from: { city: string; state: string } | undefined): { homeBase?: string; headHome?: boolean; runType?: RunType; avoidStates?: string[] } {
  if (!driver) return {};
  const status = from ? homeTimeStatus(driver, from.city, from.state, new Date()).state : "no_target";
  return {
    homeBase: driver.homeBase,
    runType: driver.runType,
    headHome: !!driver.homePriority || status === "head_home" || status === "late",
    avoidStates: driver.prefs?.avoidStates,
  };
}

/** How a driver is usually paid for each kind of run: local by the hour, in town by the move, over the road by the
 *  mile or a share of the load. Keeps their rate when the kind of pay doesn't change. */
function payFor(runType: RunType, d: Driver): Pick<Driver, "payType" | "payRate"> {
  const want: Driver["payType"] | null = runType === "local" ? "hourly" : runType === "intown" ? "per_move" : null;
  if (want) return d.payType === want ? { payType: d.payType, payRate: d.payRate } : { payType: want, payRate: want === "hourly" ? 28 : 75 };
  return d.payType === "hourly" || d.payType === "per_move" ? { payType: "per_mile", payRate: 0.62 } : { payType: d.payType, payRate: d.payRate };
}

/** Lanes this truck's driver actually runs, for the AI's own chaining. */
function fitsDriver(driver: Driver | undefined): ((lane: Lane) => boolean) | undefined {
  return driver ? (lane) => laneFits(lane, driver.runType, driver.homeBase) && driverTakes(driver.prefs, { lane }) : undefined;
}

/** Starts the AI's incident plan for a truck: nearest backup truck lined up, broker told, the steps it will work. */
function openIncident(
  state: Pick<StoreState, "trucks" | "loads" | "brokers">,
  driverId: string,
  truckId: string,
  type: IncidentType,
  note: string,
): { incident: Incident; event: ActivityEvent } {
  const truck = state.trucks.find((t) => t.id === truckId);
  const load = state.loads.find((l) => l.id === truck?.currentLoadId);
  const at = truck ? cityCoords(truck.currentCity, truck.currentState) : undefined;
  const backups = state.trucks
    .filter((t) => t.id !== truckId && t.status === "available" && !t.currentLoadId && t.equipmentType === truck?.equipmentType)
    .map((t) => {
      const c = cityCoords(t.currentCity, t.currentState);
      return { t, miles: at && c ? Math.max(12, Math.round(distanceMiles(at, c) * 1.18)) : randInt(25, 70) };
    })
    .sort((a, b) => a.miles - b.miles);
  const incident = createIncident(driverId, PRIMARY_CARRIER_ID, truckId, truck?.currentLoadId ?? null, type, note, {
    load,
    truck,
    brokerName: load ? state.brokers.find((b) => b.id === load.brokerId)?.company : undefined,
    backupTruck: backups[0]?.t,
    backupMiles: backups[0]?.miles,
  });
  return { incident, event: incidentOpenedEvent(incident, truck) };
}

// ——— Rate confirmations ———

/** Every rate con the AI reads before it's signed: checked, sent back to the broker when it's wrong, and only put
 *  in front of the owner when the broker won't fix it. A load doesn't move past "rate confirmed" until it's signed. */
function runRateCons(loads: Load[], brokers: Broker[], escalations: Escalation[], events: ActivityEvent[]) {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  for (const load of loads) {
    if (load.stage !== "rate_confirmed" || load.carrierId !== PRIMARY_CARRIER_ID) continue;
    const broker = brokers.find((b) => b.id === load.brokerId);
    const name = broker?.company ?? "the broker";
    const base = { timestamp: iso, loadId: load.id, carrierId: load.carrierId };
    let review = load.rateCon;

    if (!review) {
      review = reviewRateCon(load, broker);
    } else if (review.status === "checking" && now - Date.parse(review.startedAt) > RATE_CON_READ_MS) {
      const mc = review.issues.find((i) => i.field === "mc");
      if (!review.issues.length) {
        review = { ...review, status: "signed", signedAt: iso };
        events.push({ ...base, id: uid("act"), type: "document_captured", message: `AI checked the rate con from ${name}: matches what was agreed`, detail: `${load.referenceNumber} · rate, detention, pickup and terms all match. Signed.`, severity: "success" });
      } else if (mc) {
        // Not a typo to fix: someone other than the broker the AI negotiated with sent this. Nothing moves until a person looks.
        const esc: Escalation = {
          id: uid("esc"), loadId: load.id, carrierId: load.carrierId, rateConLoadId: load.id, createdAt: iso, status: "open", complexity: "routine",
          reason: `Possible double-brokering on ${load.lane.origin} → ${load.lane.destination}: the rate con came from ${mc.onDoc}, not ${name}. The AI hasn't signed it. Approve only if you've confirmed it with ${name} by phone.`,
          recommendedAction: "reject", recommendedLabel: "Walk away from this load",
        };
        escalations.unshift(esc);
        review = { ...review, status: "needs_you", escalationId: esc.id };
        events.push({ ...base, id: uid("act"), type: "escalation", message: `Rate con from ${name} has a different MC on it`, detail: esc.reason, severity: "warning" });
      } else {
        review = { ...review, status: "fixing", askedAt: iso };
        events.push({
          ...base, id: uid("act"), type: "negotiation_email", channel: "email",
          message: `AI found ${review.issues.length} problem${review.issues.length === 1 ? "" : "s"} on the rate con from ${name}`,
          detail: `${review.issues.map((i) => `${i.label}: says ${i.onDoc}, agreed ${i.agreed}`).join("; ")}. Asked for a corrected rate con.`,
          severity: "warning",
        });
      }
    } else if (review.status === "fixing" && now - Date.parse(review.askedAt ?? review.startedAt) > RATE_CON_FIX_MS) {
      review = brokerCorrects(review, load.id);
      const saved = savedBy(review);
      if (review.issues.every((i) => i.status === "fixed")) {
        review = { ...review, status: "signed", signedAt: iso };
        events.push({ ...base, id: uid("act"), type: "document_captured", message: `${name} sent a corrected rate con. AI signed it`, detail: `${load.referenceNumber}${saved ? ` · kept $${saved.toLocaleString()} that would have been lost` : " · terms now match what was agreed"}`, severity: "success" });
      } else {
        const esc: Escalation = {
          id: uid("esc"), loadId: load.id, carrierId: load.carrierId, rateConLoadId: load.id, createdAt: iso, status: "open", complexity: "routine",
          reason: `${name} won't change the rate con on ${load.lane.origin} → ${load.lane.destination}. ${refusedSummary(review)}.${saved ? ` They did fix the rest ($${saved.toLocaleString()} kept).` : ""} Sign it anyway, or walk away before a truck is sent?`,
          recommendedAction: "approve", recommendedLabel: "Accept and sign",
        };
        escalations.unshift(esc);
        review = { ...review, status: "needs_you", escalationId: esc.id };
        events.push({ ...base, id: uid("act"), type: "escalation", message: `${name} won't fix the rate con. Needs your call`, detail: esc.reason, severity: "warning" });
      }
    } else continue;

    const next = review;
    loads.splice(loads.indexOf(load), 1, { ...load, rateCon: next });
  }
}

/** The owner's answer on a rate con the broker wouldn't fix: sign it as is, or walk away before any truck rolls. */
function rateConDecision(state: StoreState, escalationId: string, approve: boolean) {
  const esc = state.escalations.find((e) => e.id === escalationId);
  const load = esc?.rateConLoadId ? state.loads.find((l) => l.id === esc.rateConLoadId) : undefined;
  if (!esc || !load?.rateCon || load.rateCon.status !== "needs_you") return null;
  const iso = new Date().toISOString();
  const name = state.brokers.find((b) => b.id === load.brokerId)?.company ?? "the broker";
  const base = { id: uid("act"), timestamp: iso, loadId: load.id, carrierId: load.carrierId };
  if (approve) {
    const rateCon: RateConReview = { ...load.rateCon, status: "signed", signedAt: iso, issues: load.rateCon.issues.map((i) => (i.status === "fixed" ? i : { ...i, status: "accepted" as const })) };
    return {
      loads: state.loads.map((l) => (l.id === load.id ? { ...l, rateCon } : l)),
      trucks: state.trucks,
      events: [{ ...base, type: "document_captured" as const, message: `Rate con from ${name} accepted as is. AI signed it`, detail: load.referenceNumber, severity: "info" as const }],
    };
  }
  return {
    loads: state.loads.map((l) =>
      l.id === load.id ? { ...l, stage: "declined" as const, cancellationReason: "Walked away: the broker wouldn't fix the rate con", updatedAt: iso, progressPct: 100, rateCon: { ...load.rateCon!, status: "walked" as const } } : l,
    ),
    // Nothing was dispatched yet, so no TONU either way; the truck just goes back to getting offers.
    trucks: state.trucks.map((t) =>
      t.nextLoadId === load.id ? { ...t, nextLoadId: null } : t.currentLoadId === load.id ? { ...t, currentLoadId: null, status: "available" as const } : t,
    ),
    events: [{ ...base, type: "load_cancelled" as const, message: `Walked away from ${name}'s load over the rate con`, detail: `${load.lane.origin} → ${load.lane.destination} · nothing dispatched, the AI is finding another load`, severity: "info" as const }],
  };
}

// ——— AI dispatch calls ———

/** Everything a call can touch, gathered so the tick and the driver's own taps change it the same way. */
interface CallDraft {
  brokers: Broker[];
  incidents: Incident[];
  loads: Load[];
  trucks: Truck[];
  drivers: Driver[];
  escalations: Escalation[];
  driverMessages: DriverMessage[];
  dispatchCalls: DispatchCall[];
  events: ActivityEvent[];
  /** The language the owner reads calls in on the dashboard. */
  readLang: Lang;
  /** Owner-operator: there's no office to call back, so a driver asking for a person gets Backroute Support. */
  solo: boolean;
  /** Signed in to a real account: every driver is a real person, so nobody picks up a call on their own. */
  live: boolean;
}

function draftFrom(state: StoreState): CallDraft {
  const { brokers, incidents, loads, trucks, drivers, escalations, driverMessages, dispatchCalls } = state;
  return { brokers, incidents, loads, trucks, drivers, escalations, driverMessages, dispatchCalls, events: [], readLang: readLangOf(state.settings), solo: state.settings.ownerOperator, live: state.session.mode !== "demo" };
}

function callDraftResult(d: CallDraft) {
  const { incidents, loads, trucks, drivers, escalations, driverMessages, dispatchCalls } = d;
  return { incidents, loads, trucks, drivers, escalations, driverMessages, dispatchCalls };
}

function patchCall(d: CallDraft, id: string, patch: Partial<DispatchCall>) {
  d.dispatchCalls = d.dispatchCalls.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

function textDriver(d: CallDraft, driverId: string, content: string) {
  d.driverMessages = [...d.driverMessages, { id: uid("dm"), driverId, from: "ai", content, timestamp: new Date().toISOString() }];
}

function callEvent(d: CallDraft, call: DispatchCall, message: string, detail: string, severity: ActivityEvent["severity"] = "info") {
  d.events.push({ id: uid("act"), timestamp: new Date().toISOString(), type: "check_call", channel: "voice", message, detail, loadId: call.loadId, carrierId: call.carrierId, severity });
}

/** The call can't happen (held, missed, declined): the driver gets the same information by text, once. */
function textInstead(d: CallDraft, call: DispatchCall) {
  if (call.textedAt) return;
  textDriver(d, call.driverId, textCopyFor(call));
  patchCall(d, call.id, { textedAt: new Date().toISOString() });
}

function ringCall(d: CallDraft, call: DispatchCall) {
  const driver = d.drivers.find((x) => x.id === call.driverId);
  // A call that waited (sleeper, quiet hours) rings in the language the driver talks in now, not when it was queued.
  patchCall(d, call.id, { status: "ringing", ringingAt: new Date().toISOString(), channel: driver?.prefs?.reach ?? "app", lang: driverLang(driver) });
}

/** The language the owner reads driver calls in on the dashboard. */
export function readLangOf(settings: Pick<AgentSettings, "ownerLanguage" | "transcriptsIn">): Lang {
  return settings.transcriptsIn === "mine" ? settings.ownerLanguage : "en";
}

/** Who reads this call in a language other than the one it's spoken in: the owner on the dashboard, and the driver
 *  when their app is in a different language than they talk in. */
function readersOf(d: CallDraft, call: DispatchCall): Lang[] {
  const appLang = d.drivers.find((x) => x.id === call.driverId)?.prefs?.appLanguage ?? "en";
  return Array.from(new Set([d.readLang, appLang])).filter((l) => l !== call.lang);
}

/** The same words in each reader's language, or undefined when everyone reads the spoken language. */
function trFor(langs: Lang[], words: (lang: Lang) => string | undefined): Translations | undefined {
  if (!langs.length) return undefined;
  const tr: Translations = {};
  for (const l of langs) {
    const w = words(l);
    if (w) tr[l] = w;
  }
  return tr;
}

/** A turn said in the call's language, carrying each reader's version of the line and of every button. */
function translated(langs: Lang[], turn: Turn, inLang: (lang: Lang) => Turn) {
  const others = new Map(langs.map((l) => [l, inLang(l)] as const));
  return {
    ...turn,
    tr: trFor(langs, (l) => others.get(l)?.say),
    choices: turn.choices.map((ch, i) => ({ ...ch, tr: trFor(langs, (l) => others.get(l)?.choices[i]?.label) })),
  };
}

/** The AI's opening line, said in the driver's language and kept in every reader's. */
function openingFor(d: CallDraft, call: DispatchCall) {
  return translated(readersOf(d, call), openCall(call), (l) => openCall(call, l));
}

function answerCall(d: CallDraft, call: DispatchCall) {
  const turn = openingFor(d, call);
  const now = new Date().toISOString();
  patchCall(d, call.id, { status: "live", answeredAt: now, lines: [{ speaker: "ai", text: turn.say, at: now, tr: turn.tr }], choices: turn.choices, step: turn.step });
}

/** One back-and-forth on a live call. `heard` is what the driver actually said, when they spoke instead of tapping. */
function replyToCall(d: CallDraft, callId: string, reply: string, heard?: string) {
  const call = d.dispatchCalls.find((c) => c.id === callId);
  if (!call || call.status !== "live") return;
  const L = pack(call.lang);
  const readers = readersOf(d, call);
  const choice = call.choices.find((ch) => ch.reply === reply);
  const said = heard ?? (reply === "again" ? L.saidAgain : reply === "person" ? L.saidPerson : choice?.say ?? reply);
  // What the driver said, for readers of other languages: the button's own translation when there is one. Words
  // the driver actually spoke stay as spoken; translating free speech needs the real voice AI.
  const saidTr = heard
    ? undefined
    : trFor(readers, (l) => (reply === "again" ? pack(l).saidAgain : reply === "person" ? pack(l).saidPerson : choice?.tr?.[l]));
  const now = new Date().toISOString();

  // The owner has the call now: the AI only listens and keeps the record.
  if (call.ownerTookOver) {
    patchCall(d, callId, { lines: [...call.lines, { speaker: "driver", text: said, at: now, tr: saidTr }] });
    return;
  }

  let turn = translated(readers, respond(call, reply), (l) => respond(call, reply, l));
  const toSupport = d.solo && (d.live || call.driverId === PRIMARY_DRIVER_ID) && !!turn.report?.person;
  if (toSupport && reply === "person") turn = { ...turn, say: L.personSupport, tr: trFor(readers, (l) => pack(l).personSupport) };
  patchCall(d, callId, {
    lines: [...call.lines, { speaker: "driver", text: said, at: now, tr: saidTr }, { speaker: "ai", text: turn.say, at: now, tr: turn.tr }],
    choices: turn.choices,
    step: turn.step,
    ...(turn.effects ? { effects: turn.effects } : {}),
    ...(turn.outcome !== undefined ? { outcome: turn.outcome } : {}),
    ...(turn.facts ? { facts: { ...call.facts, ...turn.facts } } : {}),
  });
  const driver = d.drivers.find((x) => x.id === call.driverId);
  const first = driver?.name.split(" ")[0] ?? "Driver";
  // A breakdown or a late truck is worked the moment it's said, not when the driver hangs up.
  if (turn.report?.incident && driver) {
    const { incident, event } = openIncident(d, driver.id, driver.truckId, turn.report.incident.type, turn.report.incident.note);
    d.incidents = [incident, ...d.incidents];
    d.events.push(event);
  }
  if (turn.report?.person) {
    const esc: Escalation = {
      id: uid("esc"), loadId: call.loadId ?? "", carrierId: call.carrierId,
      reason: toSupport
        ? `${turn.report.person} on an AI call (${KIND_LABEL[call.kind].toLowerCase()}). Backroute Support is calling back.`
        : `${turn.report.person} on an AI call (${KIND_LABEL[call.kind].toLowerCase()}). Call them back at ${driver?.phone ?? "their number"}.`,
      createdAt: now, status: toSupport ? "with_support" : "open", complexity: "routine",
      recommendedAction: "approve", recommendedLabel: `Called ${first} back`,
    };
    d.escalations = [esc, ...d.escalations];
    d.events.push({ id: uid("act"), timestamp: now, type: "escalation", message: `${first} wants a person on the phone`, detail: esc.reason, loadId: call.loadId, carrierId: call.carrierId, severity: "warning" });
  }
  if (turn.end) endCall(d, callId);
}

/** Hang up: whatever was agreed happens now, the load keeps a recording, and the driver gets a text copy. */
function endCall(d: CallDraft, callId: string) {
  const call = d.dispatchCalls.find((c) => c.id === callId);
  if (!call || (call.status !== "live" && call.status !== "ringing")) return;
  const now = new Date().toISOString();
  const driver = d.drivers.find((x) => x.id === call.driverId);
  const first = driver?.name.split(" ")[0] ?? "the driver";

  for (const effect of call.effects) {
    if (effect.type === "book") {
      if (!d.loads.some((l) => l.id === effect.loadId && l.stage === "offered")) continue;
      const resolved = resolveLoadOffer(d.loads, effect.groupId, effect.loadId, "driver");
      d.loads = resolved.loads;
      const chosen = d.loads.find((l) => l.id === effect.loadId);
      if (chosen?.truckId) d.trucks = d.trucks.map((t) => (t.id === chosen.truckId && t.currentLoadId ? { ...t, nextLoadId: chosen.id } : t));
      d.events.push(...resolved.events);
    } else if (effect.type === "reserve_parking") {
      callEvent(d, call, `AI reserved parking for ${first}`, `${effect.place} · $${effect.cost} on the fleet card`, "success");
    } else if (effect.type === "prefs") {
      d.drivers = d.drivers.map((x) => (x.id === call.driverId ? { ...x, prefs: { ...x.prefs, ...effect.prefs } } : x));
    }
  }

  const answered = call.status === "live";
  const outcome = call.outcome ?? (answered ? "Driver hung up" : undefined);
  patchCall(d, callId, { status: "done", endedAt: now, choices: [], outcome });
  // A copy of anything with a number in it — unless the same text already went out while the call was held.
  if (answered && (!call.textedAt || call.effects.length)) {
    textDriver(d, call.driverId, textCopyFor(call));
    patchCall(d, callId, { textedAt: now });
  }

  // A load call is kept on the load that got booked; the others on the load they were about.
  const booked = call.effects.find((e) => e.type === "book");
  const recordOn = call.kind === "next_load" ? (booked?.type === "book" ? booked.loadId : undefined) : call.loadId;
  if (answered && recordOn && call.lines.length) {
    const startedAt = call.answeredAt ?? call.createdAt;
    const record: VoiceCall = {
      id: uid("call"), title: `AI dispatch call with ${first} · ${KIND_LABEL[call.kind]}`, status: "completed", startedAt,
      durationSec: Math.max(12, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
      transcript: call.lines.map((l) => ({ speaker: l.speaker === "owner" ? "carrier" : l.speaker, text: l.text })), outcome,
    };
    d.loads = d.loads.map((l) => (l.id === recordOn ? { ...l, calls: [...l.calls, record] } : l));
  }
  if (answered) callEvent(d, call, `AI called ${first}: ${KIND_LABEL[call.kind].toLowerCase()}`, outcome ?? "Call ended");
}

/** The calls the AI decides to make this tick, then who's ringing, held, missed or talking. */
function runDispatchCalls(d: CallDraft, newOfferBatches: { truckId: string; offers: Load[]; emptyAt: EmptyAt }[]) {
  const now = new Date();
  const nowMs = now.getTime();
  const has = (driverId: string, kind: DispatchCallKind, loadId?: string) => d.dispatchCalls.some((c) => c.driverId === driverId && c.kind === kind && c.loadId === loadId);
  const queue = (call: DispatchCall | null) => {
    if (call) d.dispatchCalls = [call, ...d.dispatchCalls].slice(0, 60);
  };

  // New options for a truck the driver picks for: a call, or a text if that's what the driver asked for.
  for (const batch of newOfferBatches) {
    const truck = d.trucks.find((t) => t.id === batch.truckId);
    const driver = d.drivers.find((x) => x.id === truck?.driverId);
    if (!truck || !driver) continue;
    const call = nextLoadCall(driver, batch.offers, batch.emptyAt, !!truck.secondDriverId);
    if (!call) continue;
    if (driver.prefs?.newLoads === "text") textDriver(d, driver.id, textCopyFor(call));
    else queue(call);
  }

  // The calls a dispatcher makes while a load is moving.
  for (const truck of d.trucks) {
    const driver = d.drivers.find((x) => x.id === truck.driverId);
    const load = d.loads.find((l) => l.id === truck.currentLoadId);
    if (!driver || !load || driver.carrierId !== PRIMARY_CARRIER_ID) continue;
    const p = legProgress(load, nowMs);
    // Briefs come about an hour out, the way a dispatcher calls before the gate — not at the start of a long run.
    const near = (leg: "pickup" | "delivery") => legMiles(load, leg) * (1 - p) <= 60 || p >= 0.9;
    if (load.stage === "dispatched" && (p >= 0.45 || near("pickup")) && !has(driver.id, "pickup_brief", load.id)) queue(briefCall(driver, load, "pickup", p));
    if (load.stage !== "in_transit") continue;
    const milesLeft = load.lane.miles * (1 - p);
    const longRun = driver.runType === "otr" || driver.runType === "regional";
    if (longRun && p >= 0.12 && p < 0.6 && milesLeft / 50 > driver.hoursRemaining && !has(driver.id, "hours_parking", load.id)) {
      const { call, newWindow } = parkingCall(driver, load, milesLeft);
      d.loads = d.loads.map((l) => (l.id === load.id ? { ...l, deliveryWindow: newWindow } : l));
      callEvent(d, call, `AI moved ${driver.name.split(" ")[0]}'s delivery to tomorrow`, `${load.lane.destination} · out of drive hours before the receiver, broker told`, "warning");
      queue(call);
    } else if (p >= 0.25 && p < 0.55 && lateOnThisLoad(load.id) && !has(driver.id, "late_eta", load.id) && !has(driver.id, "hours_parking", load.id)) {
      const { call, newWindow } = lateCall(driver, load);
      d.loads = d.loads.map((l) => (l.id === load.id ? { ...l, deliveryWindow: newWindow } : l));
      callEvent(d, call, "AI moved a delivery appointment", `${load.lane.destination} · ${call.facts.road} wreck, ${newWindow.toLowerCase()}, receiver and broker told`, "warning");
      queue(call);
    }
    if (near("delivery") && !has(driver.id, "delivery_brief", load.id)) queue(briefCall(driver, load, "delivery", p));
  }

  // Calls that stopped mattering (the stop was reached, the load was picked in the app) never ring.
  for (const call of d.dispatchCalls) {
    if ((call.status === "queued" || call.status === "held" || call.status === "ringing") && !stillRelevant(call, d.loads)) {
      patchCall(d, call.id, { status: "dropped", endedAt: now.toISOString(), outcome: "Not needed anymore", choices: [] });
    }
  }

  for (const driver of d.drivers) {
    const mine = d.dispatchCalls.filter((c) => c.driverId === driver.id);
    const active = mine.find((c) => c.status === "ringing" || c.status === "live");
    const primary = d.live || driver.id === PRIMARY_DRIVER_ID;

    if (active?.status === "ringing") {
      const ringingFor = nowMs - Date.parse(active.ringingAt ?? active.createdAt);
      // Other drivers in the demo pick up on their own, so the carrier sees calls play out across the fleet.
      if (!primary && ringingFor > 6000) answerCall(d, active);
      else if (ringingFor > RING_MS) {
        patchCall(d, active.id, { status: "missed", endedAt: now.toISOString(), outcome: "No answer. Texted instead", choices: [] });
        textInstead(d, active);
        callEvent(d, active, `${driver.name.split(" ")[0]} missed an AI call`, `${KIND_LABEL[active.kind]} · sent by text instead`);
      }
      continue;
    }
    if (active?.status === "live") {
      if (primary) continue;
      const last = active.lines.at(-1);
      if (active.ownerTookOver) {
        // Talking with the owner now: the driver answers them, and the owner hangs up when they're done.
        if (last?.speaker === "owner" && nowMs - Date.parse(last.at) > 3000) replyToCall(d, active.id, "ack");
        continue;
      }
      if (last && nowMs - Date.parse(last.at) > 4000) {
        // A driver who takes the call the ordinary way: yes to the load or the parking spot, then "got it".
        const choice = ["book:0", "reserve", "bye"].map((r) => active.choices.find((ch) => ch.reply === r)).find(Boolean) ?? active.choices.at(-1);
        if (choice) replyToCall(d, active.id, choice.reply);
        else endCall(d, active.id);
      }
      continue;
    }

    const waiting = mine.filter((c) => c.status === "queued" || c.status === "held").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (!waiting.length) continue;
    const lastEnded = Math.max(0, ...mine.filter((c) => c.endedAt && c.status !== "dropped").map((c) => Date.parse(c.endedAt!)));
    const quiet = quietReason(driver, now);
    for (const call of waiting) {
      if (quiet) {
        if (call.status !== "held") {
          patchCall(d, call.id, { status: "held", heldReason: quiet });
          textInstead(d, call);
          callEvent(d, call, `AI held a call to ${driver.name.split(" ")[0]}`, `${quiet}. Texted instead, will call if it still matters later`);
        }
      } else if (call.status === "held") patchCall(d, call.id, { status: "queued", heldReason: undefined });
    }
    if (!quiet && nowMs - lastEnded > CALL_GAP_MS) ringCall(d, waiting[0]);
  }
}

export type DriverDocType = "bol" | "pod" | "lumper_receipt";

const DRIVER_DOC_LABEL: Record<DriverDocType, string> = { bol: "BOL", pod: "POD", lumper_receipt: "lumper receipt" };

/** What the AI "reads" off a driver's document photo — the details a dispatcher would otherwise check by hand. */
function readDriverDocument(load: Load, type: DriverDocType): { note: string; lumperAmount?: number } {
  if (type === "bol") {
    const seal = load.tripChecklist?.sealNumber ? ` · seal ${load.tripChecklist.sealNumber}` : "";
    return { note: `${randInt(18, 26)} pallets · ${load.weight.toLocaleString()} lbs${seal}. Shipper signed, matches the rate con.` };
  }
  if (type === "pod") return { note: "Signed by the receiver, no shortages or damage noted." };
  const amount = randInt(85, 240);
  return { note: `$${amount} lumper fee. Sent for reimbursement.`, lumperAmount: amount };
}

export type Aggressiveness = "conservative" | "balanced" | "aggressive";

/** How much the AI books on its own: every pick by a person, anything that clears the carrier's rules, or all of it. */
export type Autonomy = "ask" | "rules" | "full";

export interface AgentSettings {
  autonomy: Autonomy;
  aggressiveness: Aggressiveness;
  autoBookEnabled: boolean;
  autoBookThreshold: number;
  voiceEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  tmsProvider: string;
  tmsConnected: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
  /** The owner's end-of-day summary text. */
  dailyText: boolean;
  /** The language the owner is texted and talked to in: the end-of-day text. */
  ownerLanguage: Lang;
  /** Driver call transcripts on the dashboard: in the dashboard's language (English), or in the owner's own. */
  transcriptsIn: "dashboard" | "mine";
  /** One truck, and the owner drives it: the driver app becomes the whole business — loads, money, approvals. */
  ownerOperator: boolean;
  rateFloorPct: number;
  avoidWatchBrokers: boolean;
  offersPerTruck: number;
  enabledAddons: string[];
  /** Carrier's own call on a broker, overriding what the AI decided from its record. */
  brokerOverrides: Record<string, BrokerPolicy>;
}

export interface LiveMetrics {
  activeCalls: number;
  activeSmsThreads: number;
  activeEmailThreads: number;
  loadsScannedToday: number;
  boardsConnected: number;
}

interface EscalationTemplate {
  reason: string;
  complexity: "routine" | "critical";
  recommendedAction?: "approve" | "reject";
  recommendedLabel?: string;
}

/** Routine cases: the AI already knows the right call — carrier gets a one-tap default action. Critical cases: no safe default, routed to human support instead. */
const ESCALATION_TEMPLATES: EscalationTemplate[] = [
  {
    reason: "Detention exceeding 2 hours at the receiver. Invoice ready to send.",
    complexity: "routine",
    recommendedAction: "approve",
    recommendedLabel: "Approve, send detention invoice",
  },
  {
    reason: "Broker unresponsive after 45 minutes. AI recommends re-sourcing this lane.",
    complexity: "routine",
    recommendedAction: "approve",
    recommendedLabel: "Approve, re-source the lane",
  },
  {
    reason: "Receiver requesting appointment change outside driver's HOS window.",
    complexity: "routine",
    recommendedAction: "reject",
    recommendedLabel: "Decline, propose next available window",
  },
  {
    reason: "Minor weight discrepancy at scale, within normal tolerance.",
    complexity: "routine",
    recommendedAction: "approve",
    recommendedLabel: "Approve, confirm accessorial with broker",
  },
  {
    reason: "Broker requesting rate 8% below carrier floor. Needs a judgment call on accept or walk.",
    complexity: "critical",
  },
  {
    reason: "Broker disputing the signed rate confirmation, refusing to pay the agreed amount.",
    complexity: "critical",
  },
  {
    reason: "Cargo claim filed for alleged in-transit damage. Carrier liability at stake.",
    complexity: "critical",
  },
  {
    reason: "Driver reports an unsafe delivery location after hours. Needs a real-time call.",
    complexity: "critical",
  },
];

/**
 * Who this browser is signed in as. "demo" is the built-in sample fleet with nothing saved. "office" is an owner or
 * dispatcher: this browser runs the AI and saves the fleet. "driver" sees and answers only their own things.
 * `driverId` is the driver this person is (drivers and owner-operators).
 */
export interface CloudSession {
  mode: "demo" | "office" | "driver";
  carrierId?: string;
  driverId?: string | null;
  /** A carrier with nothing saved yet: starts from the fleet read at sign-up, and the AI sources its first offers. */
  fresh?: boolean;
}

interface StoreState {
  carriers: Carrier[];
  brokers: Broker[];
  trucks: Truck[];
  drivers: Driver[];
  loads: Load[];
  activity: ActivityEvent[];
  escalations: Escalation[];
  driverMessages: DriverMessage[];
  carrierMessages: CarrierMessage[];
  incidents: Incident[];
  maintenanceAppointments: MaintenanceAppointment[];
  dvirInspections: DvirInspection[];
  timeOffRequests: TimeOffRequest[];
  expenses: Expense[];
  /** The AI's phone calls to drivers: ringing, live, held for quiet hours, or done. */
  dispatchCalls: DispatchCall[];
  settings: AgentSettings;
  liveMetrics: LiveMetrics;
  tickCount: number;
  /** Demo, or signed in to a real account (see lib/cloud). */
  session: CloudSession;
  actions: {
    tick: () => void;
    resolveEscalation: (id: string, approve: boolean, actor?: "carrier" | "ops", note?: string) => void;
    routeEscalationToSupport: (id: string) => void;
    sendDriverMessage: (driverId: string, content: string) => void;
    /** Fleet-level chat — the carrier's counterpart to sendDriverMessage. Not tied to any one load;
     *  answers from the carrier's whole book (active loads, net profit, open escalations, fleet status). */
    sendCarrierMessage: (carrierId: string, content: string) => void;
    updateSettings: (partial: Partial<AgentSettings>) => void;
    driverConfirmStage: (loadId: string) => void;
    /** Driver dismissed the "load complete" card — the truck's current (or next-to-pick) load takes over. */
    acknowledgeDelivery: (truckId: string) => void;
    /** Auto-pick on/off for a truck. Turning it on also picks from any options already waiting. */
    setAutoChain: (truckId: string, on: boolean) => void;
    /** Driver ticks off an on-site step at the stop they're at: loaded at pickup, unloaded at delivery. */
    confirmTripStep: (loadId: string, step: "loaded" | "unloaded") => void;
    setSealNumber: (loadId: string, sealNumber: string) => void;
    /** Driver photographs a document at the stop; a moment later the AI has read it and marks it verified
     *  (and for a lumper receipt, files the reimbursement itself). Re-uploading replaces the previous one. */
    uploadLoadDocument: (loadId: string, type: DriverDocType, file: { name: string; previewUrl?: string }) => void;
    recaptureDocument: (loadId: string, type: "bol" | "pod") => void;
    selectLoadOffer: (offerGroupId: string, loadId: string, actor: "driver" | "carrier") => void;
    reportIncident: (driverId: string, truckId: string, type: IncidentType, note: string) => void;
    /** Kicks off the formal insurance claim for an accident — separate from the automated incident-
     *  response steps, which just handle getting everyone safe and the load moving again. */
    startClaim: (incidentId: string) => void;
    /** Books a shop appointment and takes the truck out of the offer pool immediately (in-shop) rather
     *  than waiting for the appointment date — a scheduled truck isn't one the AI should still be booking. */
    scheduleMaintenance: (truckId: string, shopName: string, serviceType: string, scheduledFor: string) => void;
    /** Marks the appointment done, returns the truck to available, and resets the service-interval baseline. */
    completeMaintenance: (truckId: string) => void;
    /** Logs a pre-trip or post-trip DVIR. A defect on any item routes it to Escalations, same as
     *  anything else this app can flag but not resolve on its own. */
    submitDvir: (driverId: string, truckId: string, kind: "pre_trip" | "post_trip", items: DvirItem[], notes?: string) => void;
    /** Always a human call — the carrier approves or denies, never the AI. */
    requestTimeOff: (driverId: string, startDate: string, endDate: string, reason: string) => void;
    respondTimeOff: (id: string, approve: boolean) => void;
    /** Out-of-pocket cost a driver fronted on the road, submitted for reimbursement. Same human-only
     *  approval pattern as time off — this is the driver's own money, not the load's economics. */
    submitExpense: (driverId: string, loadId: string | null, category: Expense["category"], amount: number, note: string) => void;
    respondExpense: (id: string, approve: boolean) => void;
    /** Checks off one intermediate stop on a multi-stop load. Doesn't touch load.stage — the overall
     *  pickup/transit/delivery lifecycle still runs off the existing stage machine untouched. */
    completeLoadStop: (loadId: string, stopId: string) => void;
    seedInitialOffers: () => void;
    /** Long-haul targets ("Home in 2 weeks") also set the date this run is due to end. */
    updateHomeTimeTarget: (driverId: string, target: string) => void;
    /** Local, regional or long haul. Changing it drops any waiting offers that no longer fit so the AI re-sources. */
    setRunType: (driverId: string, runType: RunType) => void;
    requestBetterRate: (loadId: string, actor: "driver" | "carrier", amount?: number) => void;
    /** Cancels a booked load that's fallen through (broker pulled it, detention refused, etc.). A truck
     *  already dispatched or at pickup earns the broker's TONU fee; earlier than that, no fee applies. */
    cancelLoad: (loadId: string, reason: string) => void;
    /** Walks away from an in-progress negotiation — broker won't move, a better lane came up, whatever.
     *  Nothing's booked yet so there's no TONU; just stops pursuing this one and frees any truck it had
     *  tentatively chained to. */
    declineLoad: (loadId: string, reason: string) => void;
    /** Swaps which truck is running a load — breakdown, driver calls in sick, whatever. Only offered
     *  before the freight is actually moving (booked through at_pickup); frees the old truck back to
     *  available and puts the new one on_load. */
    reassignTruck: (loadId: string, newTruckId: string) => void;
    /** Ask the AI a question about a pending offer before committing — detention, schedule, payment terms, anything but rate (the AI already set that from data; pushing further belongs to post-selection negotiation). Phase one logs the ask and returns what to show; `resolved` true means there's nothing to wait on. */
    requestOfferDetail: (loadId: string, text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
    /** Phase two: the broker's actual answer to a non-rate ask. */
    resolveOfferDetail: (loadId: string, draft: OfferAskDraft) => string;
    sendNegotiationInstruction: (loadId: string, actor: "driver" | "carrier", text: string) => void;
    /** Has the AI pick up the phone and close a load that's stuck in email back-and-forth. */
    startBrokerCall: (loadId: string) => void;
    finishBrokerCall: (loadId: string, callId: string) => void;
    /** Persists a driver/carrier voice call about a load once it hangs up, so it shows up in the same call
     *  history as the AI's own calls to brokers — a call is only real if it leaves a record. */
    logLoadVoiceCall: (loadId: string, call: Omit<VoiceCall, "id">) => void;
    setAiPaused: (loadId: string, paused: boolean) => void;
    opsOverrideRate: (loadId: string, amount: number) => void;
    /** Ops manually re-tiers a broker — after investigating a complaint, a false-positive fraud flag,
     *  whatever the automated score missed. Same "internal action, visible to the carrier" transparency
     *  as the load-level overrides above. */
    opsSetBrokerTier: (brokerId: string, tier: Broker["tier"]) => void;
    /** Internal-only bookmark on a carrier account for follow-up — no carrier-facing effect, no activity
     *  log entry; just something Ops sees when scanning the Carriers table. */
    opsToggleCarrierFlag: (carrierId: string) => void;
    toggleAddon: (addonId: string) => void;
    /** The one autopilot setting: carriers start on "ask" and move up as they trust the AI. */
    setAutonomy: (level: Autonomy) => void;
    /** Carrier overrides the AI's call on a broker (null goes back to the AI's own). Blocking one also stops any
     *  negotiation still open with them; loads already booked stay booked. */
    setBrokerPolicy: (brokerId: string, policy: BrokerPolicy | null) => void;
    /** The carrier logs that they actually talked with a driver — the AI can't do this part. */
    logDriverCheckIn: (driverId: string) => void;
    /** Tells the AI to pick loads that get this driver home before chasing the best rate. */
    setHomePriority: (driverId: string, on: boolean) => void;
    /** The driver picks up an AI dispatch call. */
    answerDispatchCall: (callId: string) => void;
    /** "Later" on a ringing call: nothing is lost, the AI texts the same information. */
    declineDispatchCall: (callId: string) => void;
    /** The driver answers on a live call, by tapping a choice or saying it (`heard`). */
    replyDispatchCall: (callId: string, reply: string, heard?: string) => void;
    hangUpDispatchCall: (callId: string) => void;
    /** Duty status from the ELD (tappable in the demo). Sleeper and off duty hold every AI call. */
    setDutyStatus: (driverId: string, status: HosStatus) => void;
    setDriverPrefs: (driverId: string, prefs: DriverPrefs) => void;
    /** The driver asked the AI to call them and set up how it reaches them. */
    startSetupCall: (driverId: string) => void;
    /** The driver calls dispatch; the AI picks up straight away. */
    startInboundCall: (driverId: string) => void;
    /** The owner steps into a live call: the AI says so and hands over, then just keeps the record. */
    takeOverDispatchCall: (callId: string) => void;
    /** The owner talking on a call they took over. */
    ownerSayOnCall: (callId: string, text: string, quick?: QuickPhrase) => void;
  };
}

const world = generateWorld();

/**
 * Keyword-matched, not a real model — every branch below is checked against a fixed driver-state
 * snapshot rather than generated, so accuracy depends entirely on covering the phrases drivers
 * actually use and ordering specific matches before broad ones. The old broad `c.includes("load")`
 * check is the cautionary example: it fired on any sentence mentioning "load" at all, so "Why did
 * you pick THIS load for me?" and "What happens if I decline this load?" both got answered with
 * "Already working your next load..." — a reply to a question nobody asked. Narrowed to "next"
 * specifically, and meta/topic questions are checked first so they never reach it.
 */
function craftDriverReply(content: string, ctx: { driver?: Driver; currentLoad?: Load }): string {
  const c = content.toLowerCase();
  const { driver, currentLoad } = ctx;

  if (/how (does|do|is).*(dispatch|score|scoring|match|work)|how (backroute|this|it) works|explain.*dispatch/.test(c)) {
    return "I scan every connected board and inbox, score each load on real profit after fuel and empty miles, then negotiate rate by phone, text, and email. Book, track, and document the trip automatically. You just pick which load, I handle the rest.";
  }
  if (/\b(decline|reject|turn down|pass on|skip)\b.*load|what happens if i (decline|reject|skip)/.test(c)) {
    return "Nothing bad. Decline it and I'll keep sourcing others. If nobody picks within the window, your carrier's autonomy settings decide whether I auto-book the top-scored option or keep waiting.";
  }
  if (/\b(hours|hos|log ?book|eld|drive time)\b/.test(c)) {
    return driver
      ? `You've got ${driver.hoursRemaining.toFixed(1)} hours left on your clock today. I factor that into anything I book next.`
      : "Check your Profile tab for your live HOS clock. I factor it into every load I offer you.";
  }
  if (/\bhome\b.*(weekend|time|friday|saturday|sunday)|when.*home|get home|home time/.test(c)) {
    return driver
      ? `You're set up as ${RUN_TYPE_LABEL[driver.runType].toLowerCase()}, "${driver.homeTimeTarget}." I check that before booking every load. Change it anytime in Profile.`
      : "Set your home-time preference in Profile and I'll weigh it when scoring your next loads.";
  }
  if (/\b(pay|earn|settlement|paycheck)\b|how much.*(make|get)/.test(c)) {
    return driver
      ? `You're on ${payLabel(driver)}. Profile has this week's running total and every past settlement.`
      : "Check Profile for your pay statements. They update automatically after every delivery.";
  }
  if (c.includes("eta") || (c.includes("time") && !c.includes("home"))) {
    if (currentLoad) {
      const stop = nextStop(currentLoad);
      return `You're tracking on time for ${stop.label.toLowerCase()}: ${stop.window}. I'll ping you if that changes.`;
    }
    return "You're tracking on time. I'll ping you if that changes based on traffic or weather.";
  }
  if (c.includes("fuel")) return "Noted. Nearest in-network fuel stop is 12 miles ahead, best price on your card today.";
  if (/\bweigh station|scale house|\bpermit\b|oversize|overweight\b/.test(c)) {
    return "Nothing flagged on this route that needs a permit. I'll call it out up front if a load ever does.";
  }
  if (/\bweather|storm|snow|ice\b/.test(c)) {
    return "Nothing on radar for your route right now. Watching it, and I'll reroute or hold you if that changes.";
  }
  if (/\bemergency|breakdown|accident\b/.test(c)) {
    return "For anything urgent, use Report issue below, or call. That routes straight to a live human, day or night.";
  }
  if (/\bcommodity|what am i hauling|what.?s (on|in) (the|this) (truck|trailer)/.test(c)) {
    return currentLoad
      ? `${currentLoad.equipmentType} · ${currentLoad.weight.toLocaleString()} lbs, ref ${currentLoad.referenceNumber}.`
      : "Pull up your current load's detail page for the full commodity and weight breakdown.";
  }
  if (/\broute|directions|different way|reroute/.test(c)) {
    return "I don't turn-by-turn navigate you, run your own GPS, but flag a closure or big delay and I'll get ahead of it with the receiver.";
  }
  if (c.includes("detention") || c.includes("wait") || c.includes("late")) return "Logging the delay now. I'll open a detention claim with the broker if you're over 2 hours.";
  if (c.includes("next")) return "Already working your next load so you don't run empty. I'll confirm the rate as soon as it's locked.";
  if (c.includes("doc") || c.includes("pod") || c.includes("bol")) return "Got it. Snap a photo in the Documents tab and I'll verify and file it automatically.";

  // A real dispatcher wouldn't answer a genuine question with an acknowledgment — if nothing above
  // matched but this reads as a question, say so honestly instead of pretending it was logged.
  if (c.trim().endsWith("?")) {
    return "Good question. I don't have a scripted answer for that one yet, but it's flagged for the team. Report issue below if it's urgent.";
  }
  return "Got it, thanks for the update. I've logged it and will keep you posted.";
}

/** Fleet-level counterpart to craftDriverReply — same keyword-matched-against-live-state approach,
 *  scoped to the carrier's whole book instead of one driver's current load. */
function craftCarrierReply(content: string, ctx: { loads: Load[]; trucks: Truck[]; escalations: Escalation[] }): string {
  const c = content.toLowerCase();
  const { loads, trucks, escalations } = ctx;

  if (/how (does|do|is).*(dispatch|score|scoring|match|work)|how (backroute|this|it) works|explain.*dispatch/.test(c)) {
    return "I scan every connected board and inbox for your fleet, score each load on real profit after fuel and empty miles, then negotiate rate by phone, text, and email. Book, track, and document the trip. Your drivers just pick which load, I handle the rest.";
  }
  if (/\b(escalat|need my attention|anything urgent|what needs (my|me)|approval)\b/.test(c)) {
    const open = escalations.filter((e) => e.status !== "resolved");
    if (open.length === 0) return "Nothing waiting on you right now. I'll ping you the moment something needs a human call.";
    const reasons = open.slice(0, 3).map((e) => e.reason.replace(/\.+$/, ""));
    return `${open.length} open: ${reasons.join(" · ")}${open.length > 3 ? ", and more" : ""}. Check Escalations for the full list.`;
  }
  if (/\b(how many trucks|fleet size|trucks (do i have|available))\b/.test(c)) {
    const available = trucks.filter((t) => t.status === "available").length;
    return `${trucks.length} trucks on the roster, ${available} sitting available right now.`;
  }
  if (/\b(net profit|revenue|how much (have i|did i) (make|earn)|profit this)\b/.test(c)) {
    const netProfit = loads.reduce((s, l) => s + (l.netProfit ?? 0), 0);
    return `Net profit is tracking to ${formatCurrencyShort(netProfit)} this cycle across ${loads.length} loads.`;
  }
  if (/\b(active loads|how many loads|loads (right now|active))\b/.test(c)) {
    const active = loads.filter((l) => l.stage !== "delivered" && l.stage !== "declined" && l.stage !== "cancelled").length;
    return `${active} loads active right now, ${loads.filter((l) => l.stage === "delivered").length} delivered this cycle.`;
  }
  if (/\b(dot|inspection|compliance)\b/.test(c)) {
    const overdue = trucks.filter((t) => new Date(t.nextInspectionDue).getTime() < Date.now());
    if (overdue.length === 0) return "Every truck's DOT inspection is current. Nothing overdue.";
    return `${overdue.length} truck${overdue.length === 1 ? "" : "s"} overdue on DOT inspection: ${overdue.map((t) => t.unitNumber).join(", ")}. I'll avoid booking them until that clears.`;
  }
  if (/\b(worst broker|broker to avoid|low(est)? reliability broker)\b/.test(c)) {
    return "Check Negotiations. Brokers marked 'watch' tier or flagged for elevated fraud risk are the ones I'm most cautious with, and I'll never negotiate with one your settings exclude.";
  }
  if (/\b(best (lane|broker)|most profitable)\b/.test(c)) {
    return "Earnings has a live breakdown of your best lane and most profitable equipment type this cycle, updated after every delivery.";
  }
  if (/\b(setting|aggressive|autonomy|auto.?book)\b/.test(c)) {
    return "Your negotiation aggressiveness and autonomy toggles are in Settings. I follow whatever you've set there on every load.";
  }

  if (c.trim().endsWith("?")) {
    return "Good question. I don't have a scripted answer for that one yet, but it's flagged for the team.";
  }
  return "Got it, thanks for the update. I've logged it and will keep you posted.";
}

function formatCurrencyShort(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const NEGOTIATION_REPLY: Record<Exclude<InstructionCategory, "general">, (brokerName: string, origin: string, dest: string) => string> = {
  rate: (brokerName, origin, dest) => `On it. Taking that back to ${brokerName} on the ${origin} to ${dest} load now.`,
  detention: (brokerName) => `Got it. Asking ${brokerName} about detention/lumper terms on that load now.`,
  schedule: (brokerName) => `Understood. Checking with ${brokerName} about the pickup window.`,
  payment: (brokerName) => `On it. Asking ${brokerName} about quick pay on this one.`,
};

function findNegotiatingLoadForDriver(state: StoreState, driverId: string): Load | undefined {
  const driver = state.drivers.find((d) => d.id === driverId);
  const truck = driver ? state.trucks.find((t) => t.id === driver.truckId) : undefined;
  if (!truck) return undefined;
  return state.loads.find((l) => (l.id === truck.currentLoadId || l.id === truck.nextLoadId) && l.stage === "negotiating");
}

export const useStore = create<StoreState>((set, get) => ({
  ...world,
  dispatchCalls: [],
  settings: {
    autonomy: "ask",
    aggressiveness: "balanced",
    autoBookEnabled: false,
    autoBookThreshold: 350,
    voiceEnabled: true,
    smsEnabled: true,
    emailEnabled: true,
    tmsProvider: "McLeod Software",
    tmsConnected: true,
    notifyEmail: true,
    notifySms: false,
    dailyText: true,
    ownerLanguage: "en",
    transcriptsIn: "dashboard",
    ownerOperator: false,
    rateFloorPct: 96,
    avoidWatchBrokers: false,
    offersPerTruck: 3,
    enabledAddons: DEFAULT_ENABLED_ADDONS,
    brokerOverrides: {},
  },
  liveMetrics: {
    activeCalls: 9,
    activeSmsThreads: 64,
    activeEmailThreads: 47,
    loadsScannedToday: 812,
    boardsConnected: 17,
  },
  tickCount: 0,
  session: { mode: "demo" },

  actions: {
    tick: () => {
      set((state) => {
        let loads = state.loads;
        let trucks = state.trucks;
        let escalations = state.escalations;
        let incidents = state.incidents;
        const newEvents: ActivityEvent[] = [];
        const excludeTiers: Broker["tier"][] = state.settings.avoidWatchBrokers ? ["watch"] : [];
        // Brokers the AI won't book are never sourced from; slow payers get a premium on the AI's ask.
        const { brokers: bookable, surcharges } = bookableBrokers(state.brokers, state.settings.brokerOverrides);

        const offerBatches: { truckId: string; offers: Load[]; emptyAt: EmptyAt }[] = [];
        const autoBooked: { truckId: string; loadId?: string }[] = [];

        const activeLoads = loads.filter((l) => l.stage !== "delivered" && l.stage !== "declined" && l.stage !== "cancelled" && l.carrierId === PRIMARY_CARRIER_ID);

        // Background market activity: loads the AI is working speculatively, not yet tied to a truck.
        if (activeLoads.length < 13 && Math.random() < 0.32) {
          const newLoad = createSourcedLoad(bookable, PRIMARY_CARRIER_ID, state.tickCount, null, false, excludeTiers, undefined, undefined, surcharges);
          loads = [newLoad, ...loads];
          newEvents.push({
            id: uid("act"), timestamp: new Date().toISOString(), type: "load_sourced",
            message: "New load sourced", detail: `${newLoad.source} · ${newLoad.lane.origin} → ${newLoad.lane.destination} · $${newLoad.listedRate.toLocaleString()}`,
            loadId: newLoad.id, carrierId: PRIMARY_CARRIER_ID, severity: "info",
          });
        }

        // Trucks with nothing lined up: AI scans the boards and hands back a shortlist to choose from.
        const freeTrucks = trucks.filter(
          (t) => t.status === "available" && !t.currentLoadId && !t.nextLoadId && !loads.some((l) => l.truckId === t.id && l.stage === "offered"),
        );
        if (freeTrucks.length && Math.random() < 0.35) {
          const truck = pick(freeTrucks);
          const driver = state.drivers.find((d) => d.id === truck.driverId);
          const offers = createLoadOfferBatch(bookable, PRIMARY_CARRIER_ID, truck.id, state.tickCount, false, state.settings.offersPerTruck, {
            excludeTiers,
            surcharges,
            ...homeOptions(driver, { city: truck.currentCity, state: truck.currentState }),
            equipmentType: truck.equipmentType,
            from: { city: truck.currentCity, state: truck.currentState },
          });
          loads = [...offers, ...loads];
          if (truck.autoChainNextLoad) {
            const picked = autoPickOffer(loads, trucks, offers, truck.id);
            loads = picked.loads;
            trucks = picked.trucks;
            newEvents.push(...picked.events);
            autoBooked.push({ truckId: truck.id, loadId: picked.events.find((e) => e.loadId)?.loadId });
          } else {
            offerBatches.push({ truckId: truck.id, offers, emptyAt: { kind: "in", city: truck.currentCity } });
            newEvents.push({
            id: uid("act"), timestamp: new Date().toISOString(), type: "load_offered",
            message: `AI found ${offers.length} ${truck.equipmentType.toLowerCase()} loads for ${truck.unitNumber}`, detail: `Scanned every connected board, awaiting ${driver ? driver.name.split(" ")[0] : "driver"}'s pick`,
            loadId: offers[0]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info",
            });
          }
        }

        // Trucks running a load with nothing chained yet: offer a shortlist for the next leg before this one delivers.
        const chainCandidates = trucks.filter(
          (t) => t.status === "on_load" && !t.nextLoadId && !loads.some((l) => l.truckId === t.id && l.stage === "offered"),
        );
        for (const truck of chainCandidates) {
          const currentLoad = loads.find((l) => l.id === truck.currentLoadId);
          if (currentLoad?.stage === "in_transit" && Math.random() < 0.22) {
            const driver = state.drivers.find((d) => d.id === truck.driverId);
            const offers = createLoadOfferBatch(bookable, PRIMARY_CARRIER_ID, truck.id, state.tickCount + 1, true, state.settings.offersPerTruck, {
              excludeTiers,
              surcharges,
              ...homeOptions(driver, { city: currentLoad.lane.destination, state: currentLoad.lane.destState }),
              equipmentType: truck.equipmentType,
              from: { city: currentLoad.lane.destination, state: currentLoad.lane.destState },
            });
            loads = [...offers, ...loads];
            if (truck.autoChainNextLoad) {
              const picked = autoPickOffer(loads, trucks, offers, truck.id);
              loads = picked.loads;
              trucks = picked.trucks;
              newEvents.push(...picked.events);
              autoBooked.push({ truckId: truck.id, loadId: picked.events.find((e) => e.loadId)?.loadId });
            } else {
              offerBatches.push({ truckId: truck.id, offers, emptyAt: { kind: "after", city: currentLoad.lane.destination } });
              newEvents.push({
                id: uid("act"), timestamp: new Date().toISOString(), type: "load_offered",
                message: `Next-load options ready for ${truck.unitNumber}`, detail: `Pre-negotiating before delivery, ${offers.length} options found`,
                loadId: offers[0]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info",
              });
            }
          }
        }

        // Auto-pick offers nobody has acted on, if autonomy is enabled.
        const staleResolved = autoResolveStaleOffers(loads, 13000, state.settings.autoBookEnabled, state.settings.rateFloorPct);
        if (staleResolved.events.length) {
          loads = staleResolved.loads;
          newEvents.push(...staleResolved.events);
          for (const ev of staleResolved.events) {
            const chosen = loads.find((l) => l.id === ev.loadId);
            if (chosen?.truckId) {
              trucks = trucks.map((t) => {
                if (t.id !== chosen.truckId) return t;
                return t.currentLoadId ? { ...t, nextLoadId: chosen.id } : t;
              });
            }
          }
        }

        // Rate cons the AI is reading or fixing; a load waits at "rate confirmed" until its rate con is signed.
        loads = [...loads];
        escalations = [...escalations];
        runRateCons(loads, state.brokers, escalations, newEvents);

        // Once a load is dispatched, the physical milestones (pickup, transit, delivery, docs) belong to the
        // driver's own confirm actions only — the automatic tick must not touch those stages, or the card
        // the driver is looking at can silently jump out from under them, racing their own taps.
        const candidates = loads.filter(
          (l) =>
            l.stage !== "delivered" && l.stage !== "declined" && l.stage !== "cancelled" && l.stage !== "offered" &&
            l.stage !== "dispatched" && l.stage !== "at_pickup" && l.stage !== "in_transit" && l.stage !== "at_delivery" &&
            !l.aiPaused && !l.liveCall && l.carrierId === PRIMARY_CARRIER_ID &&
            !(l.stage === "rate_confirmed" && l.rateCon?.status !== "signed"),
        );
        // A truck sitting empty while its own current load is still being booked is costing money right now —
        // the AI works those first, the way a dispatcher would, instead of leaving the driver parked on a
        // random draw across the whole fleet.
        const idleTruckLoads = candidates.filter((l) => trucks.some((t) => t.currentLoadId === l.id));
        if (candidates.length && Math.random() < 0.88) {
          const target = idleTruckLoads.length && Math.random() < 0.7 ? pick(idleTruckLoads) : pick(candidates);
          const broker = state.brokers.find((b) => b.id === target.brokerId);
          let effectiveTruck = trucks.find((t) => t.id === target.truckId);

          if (target.stage === "booked" && !target.truckId) {
            // Only a free truck whose driver runs this kind of lane — a local driver never gets a cross-country load.
            effectiveTruck = trucks.find(
              (t) => t.status === "available" && !t.currentLoadId && (fitsDriver(state.drivers.find((d) => d.id === t.driverId))?.(target.lane) ?? true),
            );
          }

          const workingLoad = effectiveTruck && !target.truckId ? { ...target, truckId: effectiveTruck.id } : target;
          // A negotiation that's gone a couple of rounds by email without closing: the AI picks up the phone,
          // the way a good dispatcher would, instead of sending another counter.
          const emailRounds = target.messages.filter((m) => m.channel !== "voice").length;
          const callNow = target.stage === "negotiating" && !target.calls.length && emailRounds >= 2 && state.settings.voiceEnabled && Math.random() < 0.5;
          const result = callNow
            ? (() => {
                const started = withLiveCall(workingLoad, broker);
                return { load: started.load, events: [started.event], truckUpdates: undefined };
              })()
            : advanceLoad(workingLoad, broker, effectiveTruck);
          loads = loads.map((l) => (l.id === result.load.id ? result.load : l));
          newEvents.push(...result.events);

          if (result.truckUpdates) {
            const tu = result.truckUpdates;
            trucks = trucks.map((t) => (t.id === tu.id ? { ...t, ...tu } : t));

            if (tu.status === "available" && tu.currentLoadId === null) {
              trucks = trucks.map((t) => (t.id === tu.id ? { ...t, lastDeliveredLoadId: result.load.id } : t));
              const promoted = promoteChainedLoad(trucks, tu.id, PRIMARY_CARRIER_ID);
              trucks = promoted.trucks;
              if (promoted.event) {
                newEvents.push(promoted.event);
              }
            }
          }

          if (effectiveTruck && shouldChainNextLoad(result.load, effectiveTruck)) {
            const chained = createSourcedLoad(
              bookable, PRIMARY_CARRIER_ID, state.tickCount + 1, effectiveTruck.id, true, excludeTiers, effectiveTruck.equipmentType,
              pickLaneNear(
                { city: result.load.lane.destination, state: result.load.lane.destState },
                fitsDriver(state.drivers.find((d) => d.id === effectiveTruck!.driverId)),
              ), surcharges,
            );
            loads = [chained, ...loads];
            trucks = trucks.map((t) => (t.id === effectiveTruck!.id ? { ...t, nextLoadId: chained.id } : t));
            newEvents.push({
              id: uid("act"), timestamp: new Date().toISOString(), type: "chained",
              message: "Pre-negotiating next load before delivery", detail: `${effectiveTruck.unitNumber} · ${chained.lane.origin} → ${chained.lane.destination}`,
              loadId: chained.id, carrierId: PRIMARY_CARRIER_ID, severity: "info",
            });
          }
        }

        if (Math.random() < 0.025 && candidates.length) {
          const target = pick(candidates);
          const template = pick(ESCALATION_TEMPLATES);
          const esc: Escalation = {
            id: uid("esc"), loadId: target.id, carrierId: PRIMARY_CARRIER_ID,
            reason: template.reason, createdAt: new Date().toISOString(), status: "open",
            complexity: template.complexity, recommendedAction: template.recommendedAction, recommendedLabel: template.recommendedLabel,
          };
          escalations = [esc, ...escalations];
          newEvents.push({
            id: uid("act"), timestamp: new Date().toISOString(), type: "escalation",
            message: template.complexity === "critical" ? "Escalated, needs a human judgment call" : "Escalated for a quick approval",
            detail: esc.reason, loadId: target.id, carrierId: PRIMARY_CARRIER_ID, severity: "warning",
          });
        }

        for (const esc of escalations) {
          if (esc.status === "with_support" && Math.random() < 0.3) {
            escalations = escalations.map((e) =>
              e.id === esc.id ? { ...e, status: "resolved" as const, resolvedBy: "support" as const } : e,
            );
            newEvents.push({
              id: uid("act"), timestamp: new Date().toISOString(), type: "escalation",
              message: "Backroute Support resolved this personally", detail: esc.reason, loadId: esc.loadId, carrierId: esc.carrierId, severity: "success",
            });
          }
        }

        // Free time just ran out at a dock: tell the broker detention is now running, before it's billed.
        const tickNow = Date.now();
        for (const l of loads) {
          const clock = dockClock(l, tickNow);
          if (!clock?.running || clock.freeLeft > 0 || l.tripChecklist?.detentionNoticeSent?.includes(clock.stop)) continue;
          const broker = state.brokers.find((b) => b.id === l.brokerId)?.company ?? "the broker";
          loads = loads.map((x) =>
            x.id === l.id ? { ...x, tripChecklist: { ...x.tripChecklist, detentionNoticeSent: [...(x.tripChecklist?.detentionNoticeSent ?? []), clock.stop] } } : x,
          );
          newEvents.push({
            id: uid("act"), timestamp: new Date().toISOString(), type: "check_call", channel: "email",
            message: `AI told ${broker} detention has started`, detail: `${l.referenceNumber} · 2h free time used at the ${clock.stop === "pickup" ? "shipper" : "receiver"}, $75/hr from here`,
            loadId: l.id, carrierId: l.carrierId, severity: "warning",
          });
        }

        // Every open incident moves along its plan; a step that needs a person raises one approval request and waits.
        for (const incident of incidents.filter((i) => i.status === "active")) {
          const nextStep = incident.steps.find((st) => st.status === "pending");
          if (nextStep?.owner === "human") {
            if (incident.escalationId) continue;
            const esc: Escalation = {
              id: uid("esc"), loadId: incident.loadId ?? "", carrierId: incident.carrierId, incidentId: incident.id,
              reason: `${nextStep.label.replace(/^Approve the /, "Repair quote: ")}. ${nextStep.detail ?? ""}`.trim(),
              createdAt: new Date().toISOString(), status: "open", complexity: "routine",
              recommendedAction: "approve", recommendedLabel: nextStep.label,
            };
            escalations = [esc, ...escalations];
            incidents = incidents.map((i) => (i.id === incident.id ? { ...i, escalationId: esc.id } : i));
            newEvents.push({
              id: uid("act"), timestamp: esc.createdAt, type: "escalation",
              message: "AI needs your OK on a repair", detail: esc.reason, loadId: incident.loadId ?? undefined, carrierId: incident.carrierId, severity: "warning",
            });
            continue;
          }
          if (Math.random() < 0.75) {
            const result = advanceIncident(incident);
            incidents = incidents.map((i) => (i.id === result.incident.id ? result.incident : i));
            if (result.event) newEvents.push(result.event);
          }
        }

        // The AI's phone calls to drivers: new ones it decides to make, then who's ringing, held or talking.
        const draft: CallDraft = { ...draftFrom(state), loads, trucks, escalations, events: [] };
        for (const { truckId, loadId } of autoBooked) {
          const booked = draft.loads.find((l) => l.id === loadId);
          const driverId = trucks.find((t) => t.id === truckId)?.driverId;
          if (booked && driverId) textDriver(draft, driverId, autoBookedText(driverLang(draft.drivers.find((x) => x.id === driverId)), booked));
        }
        runDispatchCalls(draft, offerBatches);
        newEvents.push(...draft.events);

        const step = (v: number, min: number, max: number, jitter = 2) => clamp(v + randInt(-jitter, jitter), min, max);

        return {
          loads: draft.loads,
          trucks: draft.trucks,
          drivers: draft.drivers,
          escalations: draft.escalations,
          driverMessages: draft.driverMessages,
          dispatchCalls: draft.dispatchCalls,
          incidents,
          activity: [...newEvents, ...state.activity].slice(0, 80),
          tickCount: state.tickCount + 1,
          liveMetrics: {
            activeCalls: step(state.liveMetrics.activeCalls, 4, 31),
            activeSmsThreads: step(state.liveMetrics.activeSmsThreads, 32, 168, 4),
            activeEmailThreads: step(state.liveMetrics.activeEmailThreads, 24, 130, 4),
            loadsScannedToday: state.liveMetrics.loadsScannedToday + randInt(3, 22),
            boardsConnected: 17,
          },
        };
      });
      const { loads, actions } = get();
      scheduleCallEnds(loads, actions.finishBrokerCall);
    },

    resolveEscalation: (id, approve, actor = "carrier", note) =>
      set((state) => {
        const rc = rateConDecision(state, id, approve);
        return {
        ...(rc ? { loads: rc.loads, trucks: rc.trucks } : {}),
        // An approval that's a step in an incident plan unblocks that plan: approved, the repair goes ahead;
        // declined, the AI falls back to relaying the freight with the backup truck.
        incidents: state.incidents.map((i) => {
          if (i.escalationId !== id) return i;
          const backup = i.steps.find((st) => st.label === "Lined up a backup truck")?.detail?.split(" ")[0];
          return {
            ...i,
            steps: i.steps.map((st) =>
              st.owner === "human" && st.status === "pending"
                ? approve
                  ? { ...st, status: "done" as const, timestamp: new Date().toISOString(), label: st.label.replace(/^Approve/, "Approved"), detail: `Approved by ${actor}. The AI booked the repair.` }
                  : { ...st, status: "done" as const, timestamp: new Date().toISOString(), label: "Repair declined", detail: backup ? `The AI is relaying the load with ${backup} instead.` : "The AI is towing the truck to the nearest in-network shop instead." }
                : st,
            ),
          };
        }),
        escalations: state.escalations.map((e) =>
          e.id === id
            ? { ...e, status: "resolved" as const, resolvedBy: actor, resolvedAt: new Date().toISOString(), resolutionNote: note || undefined }
            : e,
        ),
        activity: [
          ...(rc?.events ?? []),
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "escalation" as const,
            message: approve ? `Escalation approved by ${actor}` : `Escalation rejected by ${actor}, AI re-sourcing`,
            detail: note || state.escalations.find((e) => e.id === id)?.reason || "",
            loadId: state.escalations.find((e) => e.id === id)?.loadId,
            carrierId: PRIMARY_CARRIER_ID, severity: (approve ? "success" : "info") as ActivityEvent["severity"],
          },
          ...state.activity,
        ].slice(0, 80),
        };
      }),

    routeEscalationToSupport: (id) =>
      set((state) => ({
        escalations: state.escalations.map((e) => (e.id === id ? { ...e, status: "with_support" as const } : e)),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "escalation" as const,
            message: "Routed to Backroute Support, a specialist is reviewing this now",
            detail: state.escalations.find((e) => e.id === id)?.reason ?? "",
            loadId: state.escalations.find((e) => e.id === id)?.loadId,
            carrierId: PRIMARY_CARRIER_ID, severity: "info" as ActivityEvent["severity"],
          },
          ...state.activity,
        ].slice(0, 80),
      })),

    sendDriverMessage: (driverId, content) => {
      const msg: DriverMessage = { id: uid("dm"), driverId, from: "driver", content, timestamp: new Date().toISOString() };
      set((state) => ({ driverMessages: [...state.driverMessages, msg] }));

      setTimeout(() => {
        set((state) => {
          const target = findNegotiatingLoadForDriver(state, driverId);
          const category = classifyInstruction(content);

          if (target && category !== "general") {
            const broker = state.brokers.find((b) => b.id === target.brokerId);
            const { load: updated, events } = applyNegotiationInstruction(target, broker, "driver", content);
            const reply: DriverMessage = {
              id: uid("dm"), driverId, from: "ai",
              content: NEGOTIATION_REPLY[category](broker?.company ?? "the broker", target.lane.origin, target.lane.destination),
              timestamp: new Date().toISOString(),
            };
            return {
              loads: state.loads.map((l) => (l.id === updated.id ? updated : l)),
              activity: [...events, ...state.activity].slice(0, 80),
              driverMessages: [...state.driverMessages, reply],
            };
          }

          if (!target && category === "rate") {
            const reply: DriverMessage = {
              id: uid("dm"), driverId, from: "ai",
              content: "Nothing open to negotiate on right now. I'll push for the best number the moment I'm working a rate for you.",
              timestamp: new Date().toISOString(),
            };
            return { driverMessages: [...state.driverMessages, reply] };
          }

          const driver = state.drivers.find((d) => d.id === driverId);
          const truck = driver ? state.trucks.find((t) => t.id === driver.truckId) : undefined;
          const currentLoad = truck?.currentLoadId ? state.loads.find((l) => l.id === truck.currentLoadId) : undefined;
          const reply: DriverMessage = {
            id: uid("dm"), driverId, from: "ai",
            content: craftDriverReply(content, { driver, currentLoad }),
            timestamp: new Date().toISOString(),
          };
          return { driverMessages: [...state.driverMessages, reply] };
        });
      }, 1100 + Math.random() * 1000);
    },

    sendCarrierMessage: (carrierId, content) => {
      const msg: CarrierMessage = { id: uid("cm"), carrierId, from: "carrier", content, timestamp: new Date().toISOString() };
      set((state) => ({ carrierMessages: [...state.carrierMessages, msg] }));

      setTimeout(() => {
        set((state) => {
          const loads = state.loads.filter((l) => l.carrierId === carrierId);
          const trucks = state.trucks.filter((t) => t.carrierId === carrierId);
          const escalations = state.escalations.filter((e) => e.carrierId === carrierId);
          const reply: CarrierMessage = {
            id: uid("cm"), carrierId, from: "ai",
            content: craftCarrierReply(content, { loads, trucks, escalations }),
            timestamp: new Date().toISOString(),
          };
          return { carrierMessages: [...state.carrierMessages, reply] };
        });
      }, 1100 + Math.random() * 1000);
    },

    updateSettings: (partial) => set((state) => ({ settings: { ...state.settings, ...partial } })),

    logDriverCheckIn: (driverId) =>
      set((state) => ({ drivers: state.drivers.map((d) => (d.id === driverId ? { ...d, lastCheckInAt: new Date().toISOString() } : d)) })),

    setHomePriority: (driverId, on) =>
      set((state) => {
        const driver = state.drivers.find((d) => d.id === driverId);
        return {
          drivers: state.drivers.map((d) => (d.id === driverId ? { ...d, homePriority: on } : d)),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "time_off" as const,
              message: on ? `AI will get ${driver?.name.split(" ")[0] ?? "the driver"} home first` : `AI is back to best-paying loads for ${driver?.name.split(" ")[0] ?? "the driver"}`,
              detail: on ? "The AI only books loads that bring them closer to home, even at a lower rate." : "Home time is still checked before every load.",
              carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    setBrokerPolicy: (brokerId, policy) =>
      set((state) => {
        const overrides = { ...state.settings.brokerOverrides };
        if (policy) overrides[brokerId] = policy;
        else delete overrides[brokerId];
        const broker = state.brokers.find((b) => b.id === brokerId);
        const now = new Date().toISOString();
        const dropped = policy === "block" ? state.loads.filter((l) => l.brokerId === brokerId && ["sourced", "scoring", "negotiating"].includes(l.stage)) : [];
        const droppedIds = new Set(dropped.map((l) => l.id));
        return {
          settings: { ...state.settings, brokerOverrides: overrides },
          loads: droppedIds.size
            ? state.loads.map((l) =>
                droppedIds.has(l.id) ? { ...l, stage: "declined" as const, progressPct: 100, updatedAt: now, cancellationReason: `You chose not to book with ${broker?.company ?? "this broker"}.` } : l,
              )
            : state.loads,
          trucks: droppedIds.size ? state.trucks.map((t) => (t.nextLoadId && droppedIds.has(t.nextLoadId) ? { ...t, nextLoadId: null } : t)) : state.trucks,
          activity: [
            {
              id: uid("act"), timestamp: now, type: "escalation" as const,
              message: policy === "block" ? `AI won't book ${broker?.company ?? "this broker"} anymore` : policy === "surcharge" ? `AI will ask ${broker?.company ?? "this broker"} for a slow-pay premium` : `AI is back to its own call on ${broker?.company ?? "this broker"}`,
              detail: dropped.length ? `Stopped ${dropped.length} open negotiation${dropped.length === 1 ? "" : "s"}. Booked loads stay booked.` : "Applies to new loads from now on.",
              carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    setAutonomy: (level) =>
      set((state) => {
        let loads = state.loads;
        let trucks = state.trucks.map((t) => (level === "rules" ? t : { ...t, autoChainNextLoad: level === "full" }));
        let events: ActivityEvent[] = [];
        // Full autopilot books whatever is already waiting too, the same as switching each truck on.
        if (level === "full") {
          for (const truck of trucks) {
            const waiting = loads.filter((l) => l.truckId === truck.id && l.stage === "offered");
            if (!waiting.length) continue;
            const picked = autoPickOffer(loads, trucks, waiting, truck.id);
            loads = picked.loads;
            trucks = picked.trucks;
            events = [...events, ...picked.events];
          }
        }
        return {
          settings: { ...state.settings, autonomy: level, autoBookEnabled: level !== "ask" },
          trucks,
          loads,
          activity: [
            ...events,
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "escalation" as const,
              message: `Autopilot: ${AUTONOMY_LABEL[level]}`, detail: AUTONOMY_DETAIL[level],
              carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    toggleAddon: (addonId) =>
      set((state) => {
        const enabled = state.settings.enabledAddons.includes(addonId);
        return {
          settings: {
            ...state.settings,
            enabledAddons: enabled
              ? state.settings.enabledAddons.filter((id) => id !== addonId)
              : [...state.settings.enabledAddons, addonId],
          },
        };
      }),

    driverConfirmStage: (loadId) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const truck = state.trucks.find((t) => t.id === load.truckId);
        const result = confirmLoadStage(load, truck);
        if (result.load === load) return {};
        let trucks = state.trucks;
        const aiEvent = aiMilestoneEvent(result.load, state.brokers.find((b) => b.id === load.brokerId)?.company ?? "the broker");
        let events = aiEvent ? [...result.events, aiEvent] : result.events;
        if (result.truckUpdates) {
          const tu = result.truckUpdates;
          trucks = trucks.map((t) => (t.id === tu.id ? { ...t, ...tu } : t));
          if (tu.status === "available" && tu.currentLoadId === null) {
            trucks = trucks.map((t) => (t.id === tu.id ? { ...t, lastDeliveredLoadId: load.id } : t));
            const promoted = promoteChainedLoad(trucks, tu.id, load.carrierId);
            trucks = promoted.trucks;
            if (promoted.event) events = [...events, promoted.event];
          }
        }
        return {
          loads: state.loads.map((l) => (l.id === result.load.id ? result.load : l)),
          trucks,
          activity: [...events, ...state.activity].slice(0, 80),
        };
      }),

    acknowledgeDelivery: (truckId) =>
      set((state) => ({
        trucks: state.trucks.map((t) => (t.id === truckId ? { ...t, lastDeliveredLoadId: null } : t)),
      })),

    setAutoChain: (truckId, on) =>
      set((state) => {
        let trucks = state.trucks.map((t) => (t.id === truckId ? { ...t, autoChainNextLoad: on } : t));
        let loads = state.loads;
        let events: ActivityEvent[] = [];
        const waiting = on ? loads.filter((l) => l.truckId === truckId && l.stage === "offered") : [];
        if (waiting.length) {
          const picked = autoPickOffer(loads, trucks, waiting, truckId);
          loads = picked.loads;
          trucks = picked.trucks;
          events = picked.events;
        }
        return { trucks, loads, activity: [...events, ...state.activity].slice(0, 80) };
      }),

    confirmTripStep: (loadId, step) => {
      let claimId: string | null = null;
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const now = new Date().toISOString();
        const checklist = step === "loaded" ? { ...load.tripChecklist, loadedAt: now } : { ...load.tripChecklist, unloadedAt: now };
        const where = step === "loaded" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`;
        const stop = step === "loaded" ? "pickup" : "delivery";
        const updated: Load = { ...load, tripChecklist: checklist };
        const minutes = dockMinutes(updated, stop, Date.now()) ?? 0;
        const amount = detentionFor(minutes);
        const events: ActivityEvent[] = [
          {
            id: uid("act"), timestamp: now, type: "check_call",
            message: step === "loaded" ? "Driver confirmed loaded" : "Driver confirmed unloaded",
            detail: `${load.referenceNumber} · ${where} · ${formatDockTime(minutes)} at the dock`, loadId, carrierId: load.carrierId, severity: "info",
          },
        ];
        // Past free time: the AI bills the broker for detention itself, with the check-in and out times as proof —
        // the claim a driver usually never files because nobody has time to chase it.
        if (amount > 0) {
          claimId = uid("acc");
          updated.accessorials = [
            ...(load.accessorials ?? []),
            { id: claimId, type: "detention", stop, minutes, amount, status: "claimed", createdAt: now },
          ];
          const broker = state.brokers.find((b) => b.id === load.brokerId)?.company ?? "the broker";
          events.unshift({
            id: uid("act"), timestamp: now, type: "negotiation_email", channel: "email",
            message: `AI billed ${broker} $${amount} detention`, detail: `${load.referenceNumber} · ${formatDockTime(minutes)} at ${where}, 2h free · check-in and out times attached`,
            loadId, carrierId: load.carrierId, severity: "success",
          });
        }
        return {
          loads: state.loads.map((l) => (l.id === loadId ? updated : l)),
          activity: [...events, ...state.activity].slice(0, 80),
        };
      });
      if (!claimId) return;
      const id = claimId;
      setTimeout(() => {
        set((state) => {
          const load = state.loads.find((l) => l.id === loadId);
          const claim = load?.accessorials?.find((a) => a.id === id);
          if (!load || !claim || claim.status !== "claimed") return {};
          const broker = state.brokers.find((b) => b.id === load.brokerId)?.company ?? "The broker";
          return {
            loads: state.loads.map((l) =>
              l.id === loadId
                ? {
                    ...l,
                    netProfit: (l.netProfit ?? 0) + claim.amount,
                    accessorials: l.accessorials?.map((a) => (a.id === id ? { ...a, status: "approved" as const } : a)),
                  }
                : l,
            ),
            activity: [
              {
                id: uid("act"), timestamp: new Date().toISOString(), type: "rate_confirmed" as const, channel: "email" as const,
                message: `${broker} approved $${claim.amount} detention`, detail: `${load.referenceNumber} · added to the invoice`,
                loadId, carrierId: load.carrierId, severity: "success" as const,
              },
              ...state.activity,
            ].slice(0, 80),
          };
        });
      }, 5000);
    },

    setSealNumber: (loadId, sealNumber) =>
      set((state) => ({
        loads: state.loads.map((l) => (l.id === loadId ? { ...l, tripChecklist: { ...l.tripChecklist, sealNumber: sealNumber.trim() || undefined } } : l)),
      })),

    uploadLoadDocument: (loadId, type, file) => {
      const docId = uid("doc");
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const replaced = load.documents.find((d) => d.type === type);
        if (replaced?.previewUrl) URL.revokeObjectURL(replaced.previewUrl);
        const now = new Date().toISOString();
        const doc: LoadDocument = { id: docId, type, name: file.name, generatedAt: now, status: "pending", uploadedBy: "driver", previewUrl: file.previewUrl };
        return {
          loads: state.loads.map((l) => (l.id === loadId ? { ...l, documents: [...l.documents.filter((d) => d.type !== type), doc] } : l)),
          activity: [
            {
              id: uid("act"), timestamp: now, type: "document_captured" as const,
              message: `Driver uploaded the ${DRIVER_DOC_LABEL[type]}`, detail: `${load.referenceNumber} · AI is reading it`,
              loadId, carrierId: load.carrierId, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      });
      setTimeout(() => {
        set((state) => {
          const load = state.loads.find((l) => l.id === loadId);
          if (!load?.documents.some((d) => d.id === docId)) return {};
          const { note, lumperAmount } = readDriverDocument(load, type);
          const now = new Date().toISOString();
          const driverId = state.trucks.find((t) => t.id === load.truckId)?.driverId;
          const expense: Expense | null =
            lumperAmount && driverId
              ? { id: uid("exp"), driverId, carrierId: load.carrierId, loadId, category: "lumper", amount: lumperAmount, note: "Lumper receipt, read by AI", status: "pending", createdAt: now }
              : null;
          return {
            loads: state.loads.map((l) =>
              l.id === loadId ? { ...l, documents: l.documents.map((d) => (d.id === docId ? { ...d, status: "verified" as const, aiNote: note } : d)) } : l,
            ),
            expenses: expense ? [expense, ...state.expenses] : state.expenses,
            activity: [
              {
                id: uid("act"), timestamp: now, type: "document_captured" as const,
                message: `AI checked the ${DRIVER_DOC_LABEL[type]}`, detail: `${load.referenceNumber} · ${note}`,
                loadId, carrierId: load.carrierId, severity: "success" as const,
              },
              ...state.activity,
            ].slice(0, 80),
          };
        });
      }, 1400);
    },

    recaptureDocument: (loadId, type) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const doc = load.documents.find((d) => d.type === type);
        if (!doc) return {};
        const now = new Date().toISOString();
        return {
          loads: state.loads.map((l) =>
            l.id === loadId
              ? { ...l, documents: l.documents.map((d) => (d.id === doc.id ? { ...d, generatedAt: now, status: "verified" as const } : d)) }
              : l,
          ),
          activity: [
            {
              id: uid("act"), timestamp: now, type: "document_captured" as const,
              message: `${type.toUpperCase()} photo retaken by driver`, detail: `${load.referenceNumber} · re-verified automatically`,
              loadId, carrierId: load.carrierId, severity: "success" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    selectLoadOffer: (offerGroupId, loadId, actor) =>
      set((state) => {
        const { loads, events } = resolveLoadOffer(state.loads, offerGroupId, loadId, actor);
        const chosen = loads.find((l) => l.id === loadId);
        let trucks = state.trucks;
        if (chosen?.truckId) {
          trucks = trucks.map((t) => (t.id === chosen.truckId && t.currentLoadId ? { ...t, nextLoadId: loadId } : t));
        }
        return {
          loads,
          trucks,
          activity: [...events, ...state.activity].slice(0, 80),
        };
      }),

    reportIncident: (driverId, truckId, type, note) =>
      set((state) => {
        const { incident, event } = openIncident(state, driverId, truckId, type, note);
        return {
          incidents: [incident, ...state.incidents],
          activity: [event, ...state.activity].slice(0, 80),
        };
      }),

    startClaim: (incidentId) =>
      set((state) => {
        const incident = state.incidents.find((i) => i.id === incidentId);
        if (!incident || incident.claimStartedAt) return {};
        const now = new Date().toISOString();
        return {
          incidents: state.incidents.map((i) => (i.id === incidentId ? { ...i, claimStartedAt: now } : i)),
          activity: [
            {
              id: uid("act"), timestamp: now, type: "incident" as const,
              message: "Insurance claim started",
              detail: "Claim assist AI is preparing the filing with your policy details.",
              carrierId: incident.carrierId, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    scheduleMaintenance: (truckId, shopName, serviceType, scheduledFor) =>
      set((state) => {
        const truck = state.trucks.find((t) => t.id === truckId);
        if (!truck) return {};
        const appointment: MaintenanceAppointment = {
          id: uid("mnt"), truckId, carrierId: PRIMARY_CARRIER_ID, shopName, serviceType, scheduledFor,
          status: "scheduled", createdAt: new Date().toISOString(),
        };
        return {
          maintenanceAppointments: [appointment, ...state.maintenanceAppointments],
          trucks: state.trucks.map((t) => (t.id === truckId ? { ...t, status: "maintenance" as const } : t)),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "maintenance" as const,
              message: `${truck.unitNumber} scheduled at ${shopName}`,
              detail: `${serviceType}. AI will hold this truck out of the offer pool until service completes.`,
              carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    completeMaintenance: (truckId) =>
      set((state) => {
        const truck = state.trucks.find((t) => t.id === truckId);
        const appointment = state.maintenanceAppointments.find((a) => a.truckId === truckId && a.status === "scheduled");
        if (!truck) return {};
        return {
          maintenanceAppointments: state.maintenanceAppointments.map((a) =>
            a.id === appointment?.id ? { ...a, status: "completed" as const, completedAt: new Date().toISOString() } : a,
          ),
          trucks: state.trucks.map((t) =>
            t.id === truckId ? { ...t, status: "available" as const, lastServiceMiles: t.odometer } : t,
          ),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "maintenance" as const,
              message: `${truck.unitNumber} back in service`,
              detail: appointment ? `${appointment.serviceType} completed at ${appointment.shopName}` : "Service completed",
              carrierId: PRIMARY_CARRIER_ID, severity: "success" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    submitDvir: (driverId, truckId, kind, items, notes) =>
      set((state) => {
        const truck = state.trucks.find((t) => t.id === truckId);
        const overallStatus: "pass" | "defect" = items.some((i) => i.status === "defect") ? "defect" : "pass";
        const inspection: DvirInspection = {
          id: uid("dvir"), driverId, truckId, carrierId: PRIMARY_CARRIER_ID, kind, items, overallStatus, notes,
          createdAt: new Date().toISOString(),
        };
        const kindLabel = kind === "pre_trip" ? "Pre-trip" : "Post-trip";
        const activityEvent: ActivityEvent = {
          id: uid("act"), timestamp: new Date().toISOString(), type: "dvir" as const,
          message: `${kindLabel} DVIR ${overallStatus === "pass" ? "passed" : "flagged a defect"}: ${truck?.unitNumber ?? truckId}`,
          detail: overallStatus === "defect" ? items.filter((i) => i.status === "defect").map((i) => i.label).join(", ") : undefined,
          carrierId: PRIMARY_CARRIER_ID, severity: (overallStatus === "pass" ? "success" : "warning") as ActivityEvent["severity"],
        };

        if (overallStatus === "pass") {
          return {
            dvirInspections: [inspection, ...state.dvirInspections],
            activity: [activityEvent, ...state.activity].slice(0, 80),
          };
        }

        const escalation: Escalation = {
          id: uid("esc"), loadId: truck?.currentLoadId ?? "", carrierId: PRIMARY_CARRIER_ID,
          reason: `${kindLabel} DVIR on ${truck?.unitNumber ?? truckId} flagged a defect: ${items.filter((i) => i.status === "defect").map((i) => i.label).join(", ")}.`,
          createdAt: new Date().toISOString(), status: "open", complexity: "critical",
        };
        return {
          dvirInspections: [inspection, ...state.dvirInspections],
          escalations: [escalation, ...state.escalations],
          activity: [activityEvent, ...state.activity].slice(0, 80),
        };
      }),

    requestTimeOff: (driverId, startDate, endDate, reason) =>
      set((state) => {
        const driver = state.drivers.find((d) => d.id === driverId);
        const request: TimeOffRequest = {
          id: uid("pto"), driverId, carrierId: PRIMARY_CARRIER_ID, startDate, endDate, reason,
          status: "pending", createdAt: new Date().toISOString(),
        };
        return {
          timeOffRequests: [request, ...state.timeOffRequests],
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "time_off" as const,
              message: `${driver?.name ?? "Driver"} requested time off`,
              detail: `${startDate} – ${endDate} · ${reason}`,
              carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    respondTimeOff: (id, approve) =>
      set((state) => {
        const request = state.timeOffRequests.find((r) => r.id === id);
        if (!request) return {};
        const driver = state.drivers.find((d) => d.id === request.driverId);
        return {
          timeOffRequests: state.timeOffRequests.map((r) =>
            r.id === id ? { ...r, status: (approve ? "approved" : "denied") as "approved" | "denied", respondedAt: new Date().toISOString() } : r,
          ),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "time_off" as const,
              message: `Time off ${approve ? "approved" : "denied"}: ${driver?.name ?? "driver"}`,
              detail: `${request.startDate} – ${request.endDate}`,
              carrierId: PRIMARY_CARRIER_ID, severity: (approve ? "success" : "info") as ActivityEvent["severity"],
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    submitExpense: (driverId, loadId, category, amount, note) =>
      set((state) => {
        if (!Number.isFinite(amount) || amount <= 0) return {};
        const driver = state.drivers.find((d) => d.id === driverId);
        const expense: Expense = {
          id: uid("exp"), driverId, carrierId: PRIMARY_CARRIER_ID, loadId, category, amount: Math.round(amount), note,
          status: "pending", createdAt: new Date().toISOString(),
        };
        return {
          expenses: [expense, ...state.expenses],
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "expense" as const,
              message: `${driver?.name ?? "Driver"} submitted a ${EXPENSE_CATEGORY_LABEL[category]} expense`,
              detail: `$${expense.amount.toLocaleString()}${note ? ` · ${note}` : ""}`,
              carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    respondExpense: (id, approve) =>
      set((state) => {
        const expense = state.expenses.find((e) => e.id === id);
        if (!expense) return {};
        const driver = state.drivers.find((d) => d.id === expense.driverId);
        return {
          expenses: state.expenses.map((e) =>
            e.id === id ? { ...e, status: (approve ? "approved" : "denied") as "approved" | "denied", respondedAt: new Date().toISOString() } : e,
          ),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "expense" as const,
              message: `Expense ${approve ? "approved" : "denied"}: ${driver?.name ?? "driver"}`,
              detail: `$${expense.amount.toLocaleString()} · ${EXPENSE_CATEGORY_LABEL[expense.category]}`,
              carrierId: PRIMARY_CARRIER_ID, severity: (approve ? "success" : "info") as ActivityEvent["severity"],
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    completeLoadStop: (loadId, stopId) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        const stop = load?.stops?.find((s) => s.id === stopId);
        if (!load || !stop) return {};
        return {
          loads: state.loads.map((l) =>
            l.id === loadId ? { ...l, stops: l.stops?.map((s) => (s.id === stopId ? { ...s, completed: true } : s)) } : l,
          ),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "check_call" as const,
              message: `${stop.kind === "pickup" ? "Extra pickup" : "Partial drop"} completed: ${stop.city}, ${stop.state}`,
              detail: load.referenceNumber,
              loadId, carrierId: load.carrierId, severity: "success" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    seedInitialOffers: () =>
      set((state) => {
        if (state.loads.some((l) => l.stage === "offered")) return {};
        const truck = state.trucks.find((t) => t.id === "truck-marcus");
        if (!truck || truck.nextLoadId || !truck.currentLoadId) return {};
        const driver = state.drivers.find((d) => d.id === truck.driverId);
        const currentLoad = state.loads.find((l) => l.id === truck.currentLoadId);
        const { brokers: bookable, surcharges } = bookableBrokers(state.brokers, state.settings.brokerOverrides);
        const offers = createLoadOfferBatch(bookable, PRIMARY_CARRIER_ID, truck.id, state.tickCount, true, state.settings.offersPerTruck, {
          surcharges,
          ...homeOptions(driver, currentLoad ? { city: currentLoad.lane.destination, state: currentLoad.lane.destState } : undefined),
          equipmentType: truck.equipmentType,
          from: currentLoad ? { city: currentLoad.lane.destination, state: currentLoad.lane.destState } : undefined,
        });
        return {
          loads: [...offers, ...state.loads],
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "load_offered" as const,
              message: `Next-load options ready for ${truck.unitNumber}`,
              detail: `Pre-negotiating before delivery, ${offers.length} options found`,
              loadId: offers[0]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    updateHomeTimeTarget: (driverId, target) =>
      set((state) => {
        const weeks = /^Home in (\d) week/.exec(target)?.[1];
        return {
          drivers: state.drivers.map((d) =>
            d.id === driverId
              ? { ...d, homeTimeTarget: target, homeDueAt: weeks ? new Date(Date.now() + Number(weeks) * 7 * 24 * 60 * 60 * 1000).toISOString() : d.homeDueAt }
              : d,
          ),
        };
      }),

    setRunType: (driverId, runType) =>
      set((state) => {
        const driver = state.drivers.find((d) => d.id === driverId);
        if (!driver || driver.runType === runType) return {};
        const target = HOME_TIME_OPTIONS[runType].includes(driver.homeTimeTarget) ? driver.homeTimeTarget : HOME_TIME_OPTIONS[runType][runType === "otr" ? 1 : 0];
        const weeks = /^Home in (\d) week/.exec(target)?.[1];
        const truck = state.trucks.find((t) => t.driverId === driverId || t.secondDriverId === driverId);
        const stale = new Set(
          state.loads.filter((l) => l.truckId === truck?.id && l.stage === "offered" && !laneFits(l.lane, runType, driver.homeBase)).map((l) => l.offerGroupId),
        );
        const now = new Date().toISOString();
        return {
          drivers: state.drivers.map((d) =>
            d.id === driverId
              ? {
                  ...d,
                  runType,
                  homeTimeTarget: target,
                  homeDueAt: weeks ? new Date(Date.now() + Number(weeks) * 7 * 24 * 60 * 60 * 1000).toISOString() : d.homeDueAt,
                  ...payFor(runType, d),
                }
              : d,
          ),
          // Waiting options that no longer fit are dropped; the AI sources new ones on its next pass.
          loads: stale.size ? state.loads.map((l) => (l.stage === "offered" && stale.has(l.offerGroupId) ? { ...l, stage: "declined" as const, progressPct: 100, updatedAt: now } : l)) : state.loads,
          activity: [
            {
              id: uid("act"), timestamp: now, type: "truck_reassigned" as const,
              message: `${driver.name.split(" ")[0]} now runs ${RUN_TYPE_LABEL[runType].toLowerCase()}`,
              detail: RUN_TYPE_DETAIL[runType],
              carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    requestBetterRate: (loadId, actor, amount) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const broker = state.brokers.find((b) => b.id === load.brokerId);
        const { load: updated, events } = pushForBetterRate(load, broker, actor, amount);
        return {
          loads: state.loads.map((l) => (l.id === updated.id ? updated : l)),
          activity: [...events, ...state.activity].slice(0, 80),
        };
      }),

    cancelLoad: (loadId, reason) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const broker = state.brokers.find((b) => b.id === load.brokerId);
        const tonuEligible = load.stage === "dispatched" || load.stage === "at_pickup";
        const tonuFee = tonuEligible ? 250 : 0;
        const now = new Date().toISOString();

        return {
          loads: state.loads.map((l) =>
            l.id === loadId
              ? { ...l, stage: "cancelled" as const, cancellationReason: reason, tonuFee: tonuFee || undefined, updatedAt: now, progressPct: 100 }
              : l,
          ),
          trucks: state.trucks.map((t) =>
            t.id === load.truckId
              ? { ...t, status: "available" as const, currentLoadId: t.currentLoadId === loadId ? null : t.currentLoadId, nextLoadId: t.nextLoadId === loadId ? null : t.nextLoadId }
              : t,
          ),
          activity: [
            {
              id: uid("act"), timestamp: now, type: "load_cancelled" as const,
              message: `Load cancelled: ${broker?.company ?? load.source}`,
              detail: tonuFee ? `${reason}. TONU fee of ${formatCurrencyShort(tonuFee)} invoiced to broker` : reason,
              loadId, carrierId: load.carrierId, severity: (tonuFee ? "warning" : "info") as ActivityEvent["severity"],
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    declineLoad: (loadId, reason) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load || load.stage !== "negotiating") return {};
        const broker = state.brokers.find((b) => b.id === load.brokerId);
        const now = new Date().toISOString();

        return {
          loads: state.loads.map((l) =>
            l.id === loadId ? { ...l, stage: "declined" as const, cancellationReason: reason, updatedAt: now, progressPct: 100 } : l,
          ),
          trucks: state.trucks.map((t) =>
            t.id === load.truckId
              ? { ...t, nextLoadId: t.nextLoadId === loadId ? null : t.nextLoadId }
              : t,
          ),
          activity: [
            {
              id: uid("act"), timestamp: now, type: "load_cancelled" as const,
              message: `Stopped negotiating: ${broker?.company ?? load.source}`,
              detail: reason,
              loadId, carrierId: load.carrierId, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    reassignTruck: (loadId, newTruckId) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        const newTruck = state.trucks.find((t) => t.id === newTruckId);
        if (!load || !newTruck || newTruck.status !== "available") return {};
        const oldTruckId = load.truckId;
        const now = new Date().toISOString();

        return {
          loads: state.loads.map((l) => (l.id === loadId ? { ...l, truckId: newTruckId, updatedAt: now } : l)),
          trucks: state.trucks.map((t) => {
            if (t.id === oldTruckId) {
              return { ...t, status: "available" as const, currentLoadId: t.currentLoadId === loadId ? null : t.currentLoadId, nextLoadId: t.nextLoadId === loadId ? null : t.nextLoadId };
            }
            if (t.id === newTruckId) {
              return { ...t, status: "on_load" as const, currentLoadId: loadId, currentCity: load.lane.origin, currentState: load.lane.originState };
            }
            return t;
          }),
          activity: [
            {
              id: uid("act"), timestamp: now, type: "truck_reassigned" as const,
              message: `Reassigned to ${newTruck.unitNumber}`,
              detail: `${load.lane.origin} → ${load.lane.destination} · ${load.referenceNumber}`,
              loadId, carrierId: load.carrierId, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    requestOfferDetail: (loadId, text) => {
      const state = get();
      const load = state.loads.find((l) => l.id === loadId);
      if (!load) return { draft: { category: "general" as const }, pendingReply: "", resolved: true };
      const broker = state.brokers.find((b) => b.id === load.brokerId);
      const { load: updated, draft, pendingReply, resolved } = draftOfferAsk(load, broker, text);
      if (!pendingReply) return { draft, pendingReply: "", resolved: true };
      if (!resolved) {
        set((s) => ({
          loads: s.loads.map((l) => (l.id === updated.id ? updated : l)),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "negotiation_email" as const,
              message: "Asked AI about this offer before committing",
              detail: `${broker?.company ?? load.source} · "${text}"`,
              loadId: updated.id, carrierId: updated.carrierId, severity: "info" as const, channel: "email" as const,
            },
            ...s.activity,
          ].slice(0, 80),
        }));
      }
      return { draft, pendingReply, resolved };
    },

    resolveOfferDetail: (loadId, draft) => {
      const state = get();
      const load = state.loads.find((l) => l.id === loadId);
      if (!load) return "";
      const broker = state.brokers.find((b) => b.id === load.brokerId);
      const { load: updated, reply } = resolveOfferAsk(load, broker, draft);
      set((s) => ({
        loads: s.loads.map((l) => (l.id === updated.id ? updated : l)),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "negotiation_email" as const,
            message: updated !== load ? "Broker responded to our ask, offer updated" : "Broker responded to our ask",
            detail: `${broker?.company ?? load.source} · ${reply}`,
            loadId: updated.id, carrierId: updated.carrierId, severity: "info" as const, channel: "email" as const,
          },
          ...s.activity,
        ].slice(0, 80),
      }));
      return reply;
    },

    sendNegotiationInstruction: (loadId, actor, text) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const broker = state.brokers.find((b) => b.id === load.brokerId);
        const { load: updated, events } = applyNegotiationInstruction(load, broker, actor, text);
        if (updated === load && !events.length) return {};
        return {
          loads: state.loads.map((l) => (l.id === updated.id ? updated : l)),
          activity: [...events, ...state.activity].slice(0, 80),
        };
      }),

    startBrokerCall: (loadId) => {
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load || load.stage !== "negotiating" || load.liveCall) return {};
        const started = withLiveCall(load, state.brokers.find((b) => b.id === load.brokerId));
        return {
          loads: state.loads.map((l) => (l.id === loadId ? started.load : l)),
          activity: [started.event, ...state.activity].slice(0, 80),
        };
      });
      const { loads, actions } = get();
      scheduleCallEnds(loads, actions.finishBrokerCall);
    },

    finishBrokerCall: (loadId, callId) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load?.liveCall || load.liveCall.id !== callId) return {};
        const result = finishBrokerCall(load, state.brokers.find((b) => b.id === load.brokerId));
        return {
          loads: state.loads.map((l) => (l.id === loadId ? result.load : l)),
          activity: [...result.events, ...state.activity].slice(0, 80),
        };
      }),

    logLoadVoiceCall: (loadId, call) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const callerIsDriver = call.transcript.some((l) => l.speaker === "driver");
        const fullCall: VoiceCall = { id: uid("call"), ...call };
        return {
          loads: state.loads.map((l) => (l.id === loadId ? { ...l, calls: [...l.calls, fullCall], updatedAt: new Date().toISOString() } : l)),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "call_completed" as const,
              message: callerIsDriver ? "Driver called the AI dispatcher" : "Carrier called the AI dispatcher",
              detail: `${load.lane.origin} → ${load.lane.destination} · ${formatDuration(call.durationSec)}${call.outcome ? " · " + call.outcome : ""}`,
              loadId, carrierId: load.carrierId, severity: "info" as ActivityEvent["severity"],
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    setAiPaused: (loadId, paused) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        return {
          loads: state.loads.map((l) => (l.id === loadId ? { ...l, aiPaused: paused, opsOverridden: true, updatedAt: new Date().toISOString() } : l)),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "escalation" as const,
              message: paused ? "Ops paused the AI on this load" : "Ops resumed the AI on this load",
              detail: `${load.lane.origin} → ${load.lane.destination} · ${load.referenceNumber}`,
              loadId, carrierId: load.carrierId, severity: (paused ? "warning" : "info") as ActivityEvent["severity"],
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    opsOverrideRate: (loadId, amount) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load || !Number.isFinite(amount) || amount <= 0) return {};
        const broker = state.brokers.find((b) => b.id === load.brokerId);
        const { deadheadCost, commission, netProfit, rpm } = computeEconomics(amount, load.lane.miles, load.deadheadMiles, load.fuelCost, load.tollCost);
        const score = computeLoadScore({
          rate: amount, netProfit, miles: load.lane.miles, deadheadMiles: load.deadheadMiles, rpm,
          marketRpm: load.lane.marketRpm, brokerReliability: broker?.reliability ?? 70,
        });
        const updated: Load = {
          ...load,
          targetRate: amount,
          bookedRate: load.bookedRate !== null ? amount : load.bookedRate,
          deadheadCost, commission, netProfit, rpm, score,
          opsOverridden: true,
          updatedAt: new Date().toISOString(),
        };
        return {
          loads: state.loads.map((l) => (l.id === loadId ? updated : l)),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "negotiation_email" as const,
              message: "Ops manually overrode the rate", detail: `${broker?.company ?? load.source} · set to $${amount.toLocaleString()}`,
              loadId, carrierId: load.carrierId, severity: "warning" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    opsSetBrokerTier: (brokerId, tier) =>
      set((state) => {
        const broker = state.brokers.find((b) => b.id === brokerId);
        if (!broker || broker.tier === tier) return {};
        return {
          brokers: state.brokers.map((b) => (b.id === brokerId ? { ...b, tier } : b)),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "escalation" as const,
              message: `Ops re-tiered ${broker.company}`,
              detail: `${broker.tier} → ${tier}`,
              carrierId: PRIMARY_CARRIER_ID, severity: (tier === "watch" ? "warning" : "info") as ActivityEvent["severity"],
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    opsToggleCarrierFlag: (carrierId) =>
      set((state) => ({
        carriers: state.carriers.map((c) => (c.id === carrierId ? { ...c, flaggedForReview: !c.flaggedForReview } : c)),
      })),

    answerDispatchCall: (callId) =>
      set((state) => {
        const d = draftFrom(state);
        const call = d.dispatchCalls.find((c) => c.id === callId);
        if (call?.status !== "ringing") return {};
        answerCall(d, call);
        return { dispatchCalls: d.dispatchCalls };
      }),

    declineDispatchCall: (callId) =>
      set((state) => {
        const d = draftFrom(state);
        const call = d.dispatchCalls.find((c) => c.id === callId);
        if (call?.status !== "ringing") return {};
        patchCall(d, callId, { status: "missed", endedAt: new Date().toISOString(), outcome: "Driver said later. Texted instead", choices: [] });
        textInstead(d, call);
        return { dispatchCalls: d.dispatchCalls, driverMessages: d.driverMessages };
      }),

    replyDispatchCall: (callId, reply, heard) =>
      set((state) => {
        const d = draftFrom(state);
        replyToCall(d, callId, reply, heard);
        return { ...callDraftResult(d), activity: [...d.events, ...state.activity].slice(0, 80) };
      }),

    hangUpDispatchCall: (callId) =>
      set((state) => {
        const d = draftFrom(state);
        endCall(d, callId);
        return { ...callDraftResult(d), activity: [...d.events, ...state.activity].slice(0, 80) };
      }),

    setDutyStatus: (driverId, status) =>
      set((state) => ({ drivers: state.drivers.map((x) => (x.id === driverId ? { ...x, hosStatus: status } : x)) })),

    setDriverPrefs: (driverId, prefs) =>
      set((state) => ({ drivers: state.drivers.map((x) => (x.id === driverId ? { ...x, prefs: { ...x.prefs, ...prefs } } : x)) })),

    startSetupCall: (driverId) =>
      set((state) => {
        const driver = state.drivers.find((x) => x.id === driverId);
        if (!driver || state.dispatchCalls.some((c) => c.driverId === driverId && (c.status === "ringing" || c.status === "live"))) return {};
        // The driver asked for this one, so it rings right away instead of waiting its turn.
        const call: DispatchCall = { ...setupCall(driver), status: "ringing", ringingAt: new Date().toISOString(), channel: driver.prefs?.reach ?? "app" };
        return { dispatchCalls: [call, ...state.dispatchCalls].slice(0, 60) };
      }),

    startInboundCall: (driverId) =>
      set((state) => {
        const driver = state.drivers.find((x) => x.id === driverId);
        const truck = state.trucks.find((t) => t.id === driver?.truckId);
        if (!driver || state.dispatchCalls.some((c) => c.driverId === driverId && (c.status === "ringing" || c.status === "live"))) return {};
        const team = !!truck?.secondDriverId;
        const week = weekEarnings(state.loads.filter((l) => l.truckId === truck?.id));
        const current = state.loads.find((l) => l.id === truck?.currentLoadId);
        const now = new Date().toISOString();
        const base = inboundCall(driver, {
          weekPay: week.loads.reduce((sum, l) => sum + computeDriverPay(l, driver, team), 0),
          weekLoads: week.loads.length,
          nextBooked: state.loads.find((l) => l.id === truck?.nextLoadId),
          offers: state.loads.filter((l) => l.truckId === truck?.id && l.stage === "offered"),
          emptyAt: current ? { kind: "after", city: current.lane.destination } : { kind: "in", city: truck?.currentCity ?? "" },
          team,
        });
        const opening = openingFor(draftFrom(state), base);
        const call: DispatchCall = {
          ...base, loadId: current?.id, status: "live", channel: driver.prefs?.reach ?? "app", ringingAt: now, answeredAt: now,
          lines: [{ speaker: "ai", text: opening.say, at: now, tr: opening.tr }], choices: opening.choices, step: opening.step,
        };
        return { dispatchCalls: [call, ...state.dispatchCalls].slice(0, 60) };
      }),

    takeOverDispatchCall: (callId) =>
      set((state) => {
        const d = draftFrom(state);
        const call = d.dispatchCalls.find((c) => c.id === callId);
        if (call?.status !== "live" || call.ownerTookOver) return {};
        const now = new Date().toISOString();
        const first = d.drivers.find((x) => x.id === call.driverId)?.name.split(" ")[0] ?? "there";
        const L = pack(call.lang);
        const readers = readersOf(d, call);
        patchCall(d, callId, {
          ownerTookOver: true,
          lines: [...call.lines, { speaker: "ai", text: L.ownerJoined(first, OWNER_NAME), at: now, tr: trFor(readers, (l) => pack(l).ownerJoined(first, OWNER_NAME)) }],
          choices: [
            { label: L.ch.soundsGood, reply: "ack", say: L.ch.soundsGood, match: "good|ok|okay|yes|yeah|sure|will do", tr: trFor(readers, (l) => pack(l).ch.soundsGood) },
            { label: L.ch.holdOn, reply: "hold", say: L.ch.holdOn, match: "hold|wait|second|sec", tr: trFor(readers, (l) => pack(l).ch.holdOn) },
          ],
          outcome: `${OWNER_NAME} took the call over`,
        });
        callEvent(d, call, `${OWNER_NAME} took over an AI call with ${first}`, KIND_LABEL[call.kind]);
        return { dispatchCalls: d.dispatchCalls, activity: [...d.events, ...state.activity].slice(0, 80) };
      }),

    ownerSayOnCall: (callId, text, quick) =>
      set((state) => {
        const call = state.dispatchCalls.find((c) => c.id === callId);
        if (call?.status !== "live" || !call.ownerTookOver || (!quick && !text.trim())) return {};
        // A quick phrase reaches the driver in their language. Typed words go as typed: live translation of free
        // speech needs the real voice AI connected.
        const readers = readersOf(draftFrom(state), call);
        const line = quick
          ? { speaker: "owner" as const, text: pack(call.lang).quick[quick], at: new Date().toISOString(), tr: trFor(readers, (l) => pack(l).quick[quick]) }
          : { speaker: "owner" as const, text: text.trim(), at: new Date().toISOString() };
        return { dispatchCalls: state.dispatchCalls.map((c) => (c.id === callId ? { ...c, lines: [...c.lines, line] } : c)) };
      }),
  },
}));

export const useStoreActions = () => useStore((s) => s.actions);
