/** Helpers the store's actions share: ids, the demo simulation's pieces, and replies the demo AI gives. */
import { generateWorld, PRIMARY_CARRIER_ID } from "../mock-data";
import { createIncident, incidentOpenedEvent, resolveLoadOffer, scriptBrokerCall, type InstructionCategory } from "../engine";
import { nextStop } from "../load-status";
import { cityCoords, distanceMiles } from "../trip-geo";
import { homeTimeStatus } from "../home";
import { laneFits, RUN_TYPE_LABEL } from "../run-types";
import { payLabel } from "../settlements";
import { brokerCorrects, RATE_CON_FIX_MS, RATE_CON_READ_MS, refusedSummary, reviewRateCon, savedBy } from "../rate-con";
import { driverTakes } from "../dispatch-calls";
import type { ActivityEvent, Broker, Driver, RateConReview, Escalation, Expense, Incident, IncidentType, Lane, Load, RunType, Truck } from "../types";
import type { DriverDocType, StoreState } from "./state";

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
export const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const EXPENSE_CATEGORY_LABEL: Record<Expense["category"], string> = {
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
export function promoteChainedLoad(trucks: Truck[], truckId: string, carrierId: string): { trucks: Truck[]; event: ActivityEvent | null } {
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
export function autoPickOffer(loads: Load[], trucks: Truck[], offers: Load[], truckId: string): { loads: Load[]; trucks: Truck[]; events: ActivityEvent[] } {
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
export function aiMilestoneEvent(load: Load, brokerName: string): ActivityEvent | null {
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
export function withLiveCall(load: Load, broker: Broker | undefined): { load: Load; event: ActivityEvent } {
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
export const scheduledCalls = new Set<string>();
export function scheduleCallEnds(loads: Load[], finish: (loadId: string, callId: string) => void) {
  for (const l of loads) {
    const call = l.liveCall;
    if (!call || scheduledCalls.has(call.id)) continue;
    scheduledCalls.add(call.id);
    const remaining = Math.max(0, Date.parse(call.startedAt) + call.durationMs - Date.now());
    setTimeout(() => finish(l.id, call.id), remaining);
  }
}

/** Where home time stands for the truck's next load — a dispatcher checks this before booking anything. When it's
 *  tight, or the carrier said home first, the AI only books loads that bring the driver closer to home. */
export function homeOptions(driver: Driver | undefined, from: { city: string; state: string } | undefined): { homeBase?: string; headHome?: boolean; runType?: RunType; avoidStates?: string[] } {
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
export function payFor(runType: RunType, d: Driver): Pick<Driver, "payType" | "payRate"> {
  const want: Driver["payType"] | null = runType === "local" ? "hourly" : runType === "intown" ? "per_move" : null;
  if (want) return d.payType === want ? { payType: d.payType, payRate: d.payRate } : { payType: want, payRate: want === "hourly" ? 28 : 75 };
  return d.payType === "hourly" || d.payType === "per_move" ? { payType: "per_mile", payRate: 0.62 } : { payType: d.payType, payRate: d.payRate };
}

/** Lanes this truck's driver actually runs, for the AI's own chaining. */
export function fitsDriver(driver: Driver | undefined): ((lane: Lane) => boolean) | undefined {
  return driver ? (lane) => laneFits(lane, driver.runType, driver.homeBase) && driverTakes(driver.prefs, { lane }) : undefined;
}

/** Starts the AI's incident plan for a truck: nearest backup truck lined up, broker told, the steps it will work. */
export function openIncident(
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
export function runRateCons(loads: Load[], brokers: Broker[], escalations: Escalation[], events: ActivityEvent[]) {
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
export function rateConDecision(state: StoreState, escalationId: string, approve: boolean) {
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

export const DRIVER_DOC_LABEL: Record<DriverDocType, string> = { bol: "BOL", pod: "POD", lumper_receipt: "lumper receipt" };

/** What the AI "reads" off a driver's document photo — the details a dispatcher would otherwise check by hand. */
export function readDriverDocument(load: Load, type: DriverDocType): { note: string; lumperAmount?: number } {
  if (type === "bol") {
    const seal = load.tripChecklist?.sealNumber ? ` · seal ${load.tripChecklist.sealNumber}` : "";
    return { note: `${randInt(18, 26)} pallets · ${load.weight.toLocaleString()} lbs${seal}. Shipper signed, matches the rate con.` };
  }
  if (type === "pod") return { note: "Signed by the receiver, no shortages or damage noted." };
  const amount = randInt(85, 240);
  return { note: `$${amount} lumper fee. Sent for reimbursement.`, lumperAmount: amount };
}

export interface EscalationTemplate {
  reason: string;
  complexity: "routine" | "critical";
  recommendedAction?: "approve" | "reject";
  recommendedLabel?: string;
}

/** Routine cases: the AI already knows the right call — carrier gets a one-tap default action. Critical cases: no safe default, routed to human support instead. */
export const ESCALATION_TEMPLATES: EscalationTemplate[] = [
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

export const world = generateWorld();

/**
 * Keyword-matched, not a real model — every branch below is checked against a fixed driver-state
 * snapshot rather than generated, so accuracy depends entirely on covering the phrases drivers
 * actually use and ordering specific matches before broad ones. The old broad `c.includes("load")`
 * check is the cautionary example: it fired on any sentence mentioning "load" at all, so "Why did
 * you pick THIS load for me?" and "What happens if I decline this load?" both got answered with
 * "Already working your next load..." — a reply to a question nobody asked. Narrowed to "next"
 * specifically, and meta/topic questions are checked first so they never reach it.
 */
export function craftDriverReply(content: string, ctx: { driver?: Driver; currentLoad?: Load }): string {
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
export function craftCarrierReply(content: string, ctx: { loads: Load[]; trucks: Truck[]; escalations: Escalation[] }): string {
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

export function formatCurrencyShort(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const NEGOTIATION_REPLY: Record<Exclude<InstructionCategory, "general">, (brokerName: string, origin: string, dest: string) => string> = {
  rate: (brokerName, origin, dest) => `On it. Taking that back to ${brokerName} on the ${origin} to ${dest} load now.`,
  detention: (brokerName) => `Got it. Asking ${brokerName} about detention/lumper terms on that load now.`,
  schedule: (brokerName) => `Understood. Checking with ${brokerName} about the pickup window.`,
  payment: (brokerName) => `On it. Asking ${brokerName} about quick pay on this one.`,
};

export function findNegotiatingLoadForDriver(state: StoreState, driverId: string): Load | undefined {
  const driver = state.drivers.find((d) => d.id === driverId);
  const truck = driver ? state.trucks.find((t) => t.id === driver.truckId) : undefined;
  if (!truck) return undefined;
  return state.loads.find((l) => (l.id === truck.currentLoadId || l.id === truck.nextLoadId) && l.stage === "negotiating");
}
