import { create } from "zustand";
import { DEFAULT_ENABLED_ADDONS } from "./addons";
import { generateWorld, PRIMARY_CARRIER_ID } from "./mock-data";
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
  incidentOpenedEvent,
  pushForBetterRate,
  resolveLoadOffer,
  resolveOfferAsk,
  shouldChainNextLoad,
  type InstructionCategory,
  type OfferAskDraft,
} from "./engine";
import { computeEconomics, computeLoadScore } from "./scoring";
import { nextStop } from "./load-status";
import { clamp, formatDuration } from "./utils";
import type {
  ActivityEvent,
  Broker,
  Carrier,
  CarrierMessage,
  Driver,
  DriverMessage,
  DvirInspection,
  DvirItem,
  Escalation,
  TimeOffRequest,
  Incident,
  IncidentType,
  Load,
  MaintenanceAppointment,
  Truck,
  VoiceCall,
} from "./types";

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

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
      message: "Next load already chained — zero empty miles", detail: `${truck.unitNumber} rolling straight into the next lane`,
      loadId: chainedId, carrierId, severity: "success",
    },
  };
}

export type Aggressiveness = "conservative" | "balanced" | "aggressive";

export interface AgentSettings {
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
  rateFloorPct: number;
  avoidWatchBrokers: boolean;
  offersPerTruck: number;
  enabledAddons: string[];
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
    reason: "Detention exceeding 2 hours at the receiver — invoice ready to send.",
    complexity: "routine",
    recommendedAction: "approve",
    recommendedLabel: "Approve — send detention invoice",
  },
  {
    reason: "Broker unresponsive after 45 minutes — AI recommends re-sourcing this lane.",
    complexity: "routine",
    recommendedAction: "approve",
    recommendedLabel: "Approve — re-source the lane",
  },
  {
    reason: "Receiver requesting appointment change outside driver's HOS window.",
    complexity: "routine",
    recommendedAction: "reject",
    recommendedLabel: "Decline — propose next available window",
  },
  {
    reason: "Minor weight discrepancy at scale — within normal tolerance.",
    complexity: "routine",
    recommendedAction: "approve",
    recommendedLabel: "Approve — confirm accessorial with broker",
  },
  {
    reason: "Broker requesting rate 8% below carrier floor — needs a judgment call on accept or walk.",
    complexity: "critical",
  },
  {
    reason: "Broker disputing the signed rate confirmation — refusing to pay the agreed amount.",
    complexity: "critical",
  },
  {
    reason: "Cargo claim filed for alleged in-transit damage — carrier liability at stake.",
    complexity: "critical",
  },
  {
    reason: "Driver reports an unsafe delivery location after hours — needs a real-time call.",
    complexity: "critical",
  },
];

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
  settings: AgentSettings;
  liveMetrics: LiveMetrics;
  tickCount: number;
  actions: {
    tick: () => void;
    resolveEscalation: (id: string, approve: boolean, actor?: "carrier" | "ops") => void;
    routeEscalationToSupport: (id: string) => void;
    sendDriverMessage: (driverId: string, content: string) => void;
    /** Fleet-level chat — the carrier's counterpart to sendDriverMessage. Not tied to any one load;
     *  answers from the carrier's whole book (active loads, net profit, open escalations, fleet status). */
    sendCarrierMessage: (carrierId: string, content: string) => void;
    updateSettings: (partial: Partial<AgentSettings>) => void;
    driverConfirmStage: (loadId: string) => void;
    recaptureDocument: (loadId: string, type: "bol" | "pod") => void;
    selectLoadOffer: (offerGroupId: string, loadId: string, actor: "driver" | "carrier") => void;
    reportIncident: (driverId: string, truckId: string, type: IncidentType, note: string) => void;
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
    seedInitialOffers: () => void;
    updateHomeTimeTarget: (driverId: string, target: string) => void;
    requestBetterRate: (loadId: string, actor: "driver" | "carrier", amount?: number) => void;
    /** Cancels a booked load that's fallen through (broker pulled it, detention refused, etc.). A truck
     *  already dispatched or at pickup earns the broker's TONU fee; earlier than that, no fee applies. */
    cancelLoad: (loadId: string, reason: string) => void;
    /** Ask the AI a question about a pending offer before committing — detention, schedule, payment terms, anything but rate (the AI already set that from data; pushing further belongs to post-selection negotiation). Phase one logs the ask and returns what to show; `resolved` true means there's nothing to wait on. */
    requestOfferDetail: (loadId: string, text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
    /** Phase two: the broker's actual answer to a non-rate ask. */
    resolveOfferDetail: (loadId: string, draft: OfferAskDraft) => string;
    sendNegotiationInstruction: (loadId: string, actor: "driver" | "carrier", text: string) => void;
    /** Persists a driver/carrier voice call about a load once it hangs up, so it shows up in the same call
     *  history as the AI's own calls to brokers — a call is only real if it leaves a record. */
    logLoadVoiceCall: (loadId: string, call: Omit<VoiceCall, "id">) => void;
    setAiPaused: (loadId: string, paused: boolean) => void;
    opsOverrideRate: (loadId: string, amount: number) => void;
    toggleAddon: (addonId: string) => void;
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
    return "I scan every connected board and inbox, score each load on real profit after fuel and deadhead, negotiate rate by phone, text, and email, then book, track, and document the trip automatically — you just pick which load, I handle the rest.";
  }
  if (/\b(decline|reject|turn down|pass on|skip)\b.*load|what happens if i (decline|reject|skip)/.test(c)) {
    return "Nothing bad — decline it and I'll keep sourcing others. If nobody picks within the window, your carrier's autonomy settings decide whether I auto-book the top-scored option or just keep waiting.";
  }
  if (/\b(hours|hos|log ?book|eld|drive time)\b/.test(c)) {
    return driver
      ? `You've got ${driver.hoursRemaining.toFixed(1)} hours left on your clock today — I factor that into anything I book next.`
      : "Check your Profile tab for your live HOS clock — I factor it into every load I offer you.";
  }
  if (/\bhome\b.*(weekend|time|friday|saturday|sunday)|when.*home|get home|home time/.test(c)) {
    return driver
      ? `Your home-time preference is set to "${driver.homeTimeTarget}" — I'm already weighing that when scoring your next options. Change it anytime in Profile.`
      : "Set your home-time preference in Profile and I'll weigh it when scoring your next loads.";
  }
  if (/\b(pay|earn|settlement|paycheck)\b|how much.*(make|get)/.test(c)) {
    return driver
      ? `You're on ${driver.payType === "percentage" ? `${Math.round(driver.payRate * 100)}% of the rate` : `$${driver.payRate.toFixed(2)}/mile`} — Profile has this week's running total and every past settlement.`
      : "Check Profile for your pay statements — they update automatically after every delivery.";
  }
  if (c.includes("eta") || (c.includes("time") && !c.includes("home"))) {
    if (currentLoad) {
      const stop = nextStop(currentLoad);
      return `You're tracking on time for ${stop.label.toLowerCase()} — ${stop.window}. I'll ping you if that changes.`;
    }
    return "You're tracking on time — I'll ping you if that changes based on traffic or weather.";
  }
  if (c.includes("fuel")) return "Noted — nearest in-network fuel stop is 12 miles ahead, best price on your card today.";
  if (/\bweigh station|scale house|\bpermit\b|oversize|overweight\b/.test(c)) {
    return "Nothing flagged on this route that needs a permit — I'll call it out up front if a load ever does.";
  }
  if (/\bweather|storm|snow|ice\b/.test(c)) {
    return "Nothing on radar for your route right now — I'm watching it and will reroute or hold you if that changes.";
  }
  if (/\bemergency|breakdown|accident\b/.test(c)) {
    return "For anything urgent, use Report issue below, or call — that routes straight to a live human, day or night.";
  }
  if (/\bcommodity|what am i hauling|what.?s (on|in) (the|this) (truck|trailer)/.test(c)) {
    return currentLoad
      ? `${currentLoad.equipmentType} · ${currentLoad.weight.toLocaleString()} lbs, ref ${currentLoad.referenceNumber}.`
      : "Pull up your current load's detail page for the full commodity and weight breakdown.";
  }
  if (/\broute|directions|different way|reroute/.test(c)) {
    return "I don't turn-by-turn navigate you — run your own GPS — but flag a closure or big delay and I'll get ahead of it with the receiver.";
  }
  if (c.includes("detention") || c.includes("wait") || c.includes("late")) return "Logging the delay now. I'll open a detention claim with the broker if you're over 2 hours.";
  if (c.includes("next")) return "Already working your next load so you don't run empty — I'll confirm the rate as soon as it's locked.";
  if (c.includes("doc") || c.includes("pod") || c.includes("bol")) return "Got it — snap a photo in the Documents tab and I'll verify and file it automatically.";

  // A real dispatcher wouldn't answer a genuine question with an acknowledgment — if nothing above
  // matched but this reads as a question, say so honestly instead of pretending it was logged.
  if (c.trim().endsWith("?")) {
    return "Good question — I don't have a scripted answer for that one yet, but it's flagged for the team. Report issue below if it's urgent.";
  }
  return "Got it, thanks for the update — I've logged it and will keep you posted.";
}

/** Fleet-level counterpart to craftDriverReply — same keyword-matched-against-live-state approach,
 *  scoped to the carrier's whole book instead of one driver's current load. */
function craftCarrierReply(content: string, ctx: { loads: Load[]; trucks: Truck[]; escalations: Escalation[] }): string {
  const c = content.toLowerCase();
  const { loads, trucks, escalations } = ctx;

  if (/how (does|do|is).*(dispatch|score|scoring|match|work)|how (backroute|this|it) works|explain.*dispatch/.test(c)) {
    return "I scan every connected board and inbox for your fleet, score each load on real profit after fuel and deadhead, negotiate rate by phone, text, and email, then book, track, and document the trip — your drivers just pick which load, I handle the rest.";
  }
  if (/\b(escalat|need my attention|anything urgent|what needs (my|me)|approval)\b/.test(c)) {
    const open = escalations.filter((e) => e.status !== "resolved");
    if (open.length === 0) return "Nothing waiting on you right now — I'll ping you the moment something needs a human call.";
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
    if (overdue.length === 0) return "Every truck's DOT inspection is current — nothing overdue.";
    return `${overdue.length} truck${overdue.length === 1 ? "" : "s"} overdue on DOT inspection: ${overdue.map((t) => t.unitNumber).join(", ")}. I'll avoid booking them until that clears.`;
  }
  if (/\b(worst broker|broker to avoid|low(est)? reliability broker)\b/.test(c)) {
    return "Check Negotiations — brokers marked 'watch' tier or flagged for elevated fraud risk are the ones I'm most cautious with, and I'll never negotiate with one your settings exclude.";
  }
  if (/\b(best (lane|broker)|most profitable)\b/.test(c)) {
    return "Earnings has a live breakdown of your best lane and most profitable equipment type this cycle, updated after every delivery.";
  }
  if (/\b(setting|aggressive|autonomy|auto.?book)\b/.test(c)) {
    return "Your negotiation aggressiveness and autonomy toggles are in Settings — I follow whatever you've set there on every load.";
  }

  if (c.trim().endsWith("?")) {
    return "Good question — I don't have a scripted answer for that one yet, but it's flagged for the team.";
  }
  return "Got it, thanks for the update — I've logged it and will keep you posted.";
}

function formatCurrencyShort(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const NEGOTIATION_REPLY: Record<Exclude<InstructionCategory, "general">, (brokerName: string, origin: string, dest: string) => string> = {
  rate: (brokerName, origin, dest) => `On it — taking that back to ${brokerName} on the ${origin} to ${dest} load now.`,
  detention: (brokerName) => `Got it — asking ${brokerName} about detention/lumper terms on that load now.`,
  schedule: (brokerName) => `Understood — checking with ${brokerName} about the pickup window.`,
  payment: (brokerName) => `On it — asking ${brokerName} about quick pay on this one.`,
};

function findNegotiatingLoadForDriver(state: StoreState, driverId: string): Load | undefined {
  const driver = state.drivers.find((d) => d.id === driverId);
  const truck = driver ? state.trucks.find((t) => t.id === driver.truckId) : undefined;
  if (!truck) return undefined;
  return state.loads.find((l) => (l.id === truck.currentLoadId || l.id === truck.nextLoadId) && l.stage === "negotiating");
}

export const useStore = create<StoreState>((set, get) => ({
  ...world,
  settings: {
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
    rateFloorPct: 96,
    avoidWatchBrokers: false,
    offersPerTruck: 3,
    enabledAddons: DEFAULT_ENABLED_ADDONS,
  },
  liveMetrics: {
    activeCalls: 9,
    activeSmsThreads: 64,
    activeEmailThreads: 47,
    loadsScannedToday: 812,
    boardsConnected: 17,
  },
  tickCount: 0,

  actions: {
    tick: () =>
      set((state) => {
        let loads = state.loads;
        let trucks = state.trucks;
        let escalations = state.escalations;
        let incidents = state.incidents;
        const newEvents: ActivityEvent[] = [];
        const excludeTiers: Broker["tier"][] = state.settings.avoidWatchBrokers ? ["watch"] : [];

        const activeLoads = loads.filter((l) => l.stage !== "delivered" && l.stage !== "declined" && l.stage !== "cancelled" && l.carrierId === PRIMARY_CARRIER_ID);

        // Background market activity: loads the AI is working speculatively, not yet tied to a truck.
        if (activeLoads.length < 13 && Math.random() < 0.32) {
          const newLoad = createSourcedLoad(state.brokers, PRIMARY_CARRIER_ID, state.tickCount, null, false, excludeTiers);
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
          const offers = createLoadOfferBatch(state.brokers, PRIMARY_CARRIER_ID, truck.id, state.tickCount, false, state.settings.offersPerTruck, {
            excludeTiers,
            homeTimeTarget: driver?.homeTimeTarget,
            equipmentType: truck.equipmentType,
          });
          loads = [...offers, ...loads];
          newEvents.push({
            id: uid("act"), timestamp: new Date().toISOString(), type: "load_offered",
            message: `AI found ${offers.length} ${truck.equipmentType.toLowerCase()} loads for ${truck.unitNumber}`, detail: `Scanned every connected board — awaiting ${driver ? driver.name.split(" ")[0] : "driver"}'s pick`,
            loadId: offers[0]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info",
          });
        }

        // Trucks running a load with nothing chained yet: offer a shortlist for the next leg before this one delivers.
        const chainCandidates = trucks.filter(
          (t) => t.status === "on_load" && !t.nextLoadId && !loads.some((l) => l.truckId === t.id && l.stage === "offered"),
        );
        for (const truck of chainCandidates) {
          const currentLoad = loads.find((l) => l.id === truck.currentLoadId);
          if (currentLoad?.stage === "in_transit" && Math.random() < 0.22) {
            const driver = state.drivers.find((d) => d.id === truck.driverId);
            const offers = createLoadOfferBatch(state.brokers, PRIMARY_CARRIER_ID, truck.id, state.tickCount + 1, true, state.settings.offersPerTruck, {
              excludeTiers,
              homeTimeTarget: driver?.homeTimeTarget,
              equipmentType: truck.equipmentType,
            });
            loads = [...offers, ...loads];
            newEvents.push({
              id: uid("act"), timestamp: new Date().toISOString(), type: "load_offered",
              message: `Next-load options ready for ${truck.unitNumber}`, detail: `Pre-negotiating before delivery — ${offers.length} options found`,
              loadId: offers[0]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info",
            });
          }
        }

        // Auto-pick offers nobody has acted on, if autonomy is enabled.
        const staleResolved = autoResolveStaleOffers(loads, 13000, state.settings.autoBookEnabled);
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

        // Once a load is dispatched, the physical milestones (pickup, transit, delivery, docs) belong to the
        // driver's own confirm actions only — the automatic tick must not touch those stages, or the card
        // the driver is looking at can silently jump out from under them, racing their own taps.
        const candidates = loads.filter(
          (l) =>
            l.stage !== "delivered" && l.stage !== "declined" && l.stage !== "cancelled" && l.stage !== "offered" &&
            l.stage !== "dispatched" && l.stage !== "at_pickup" && l.stage !== "in_transit" && l.stage !== "at_delivery" &&
            !l.aiPaused && l.carrierId === PRIMARY_CARRIER_ID,
        );
        if (candidates.length && Math.random() < 0.88) {
          const target = pick(candidates);
          const broker = state.brokers.find((b) => b.id === target.brokerId);
          let effectiveTruck = trucks.find((t) => t.id === target.truckId);

          if (target.stage === "booked" && !target.truckId) {
            effectiveTruck = trucks.find((t) => t.status === "available" && !t.currentLoadId);
          }

          const workingLoad = effectiveTruck && !target.truckId ? { ...target, truckId: effectiveTruck.id } : target;
          const result = advanceLoad(workingLoad, broker, effectiveTruck);
          loads = loads.map((l) => (l.id === result.load.id ? result.load : l));
          newEvents.push(...result.events);

          if (result.truckUpdates) {
            const tu = result.truckUpdates;
            trucks = trucks.map((t) => (t.id === tu.id ? { ...t, ...tu } : t));

            if (tu.status === "available" && tu.currentLoadId === null) {
              const promoted = promoteChainedLoad(trucks, tu.id, PRIMARY_CARRIER_ID);
              trucks = promoted.trucks;
              if (promoted.event) {
                newEvents.push(promoted.event);
              }
            }
          }

          if (effectiveTruck && shouldChainNextLoad(result.load, effectiveTruck)) {
            const chained = createSourcedLoad(state.brokers, PRIMARY_CARRIER_ID, state.tickCount + 1, effectiveTruck.id, true, excludeTiers, effectiveTruck.equipmentType);
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
            message: template.complexity === "critical" ? "Escalated — needs a human judgment call" : "Escalated for a quick approval",
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

        const activeIncidents = incidents.filter((i) => i.status === "active");
        if (activeIncidents.length && Math.random() < 0.6) {
          const target = pick(activeIncidents);
          const result = advanceIncident(target);
          incidents = incidents.map((i) => (i.id === result.incident.id ? result.incident : i));
          if (result.event) newEvents.push(result.event);
        }

        const step = (v: number, min: number, max: number, jitter = 2) => clamp(v + randInt(-jitter, jitter), min, max);

        return {
          loads,
          trucks,
          escalations,
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
      }),

    resolveEscalation: (id, approve, actor = "carrier") =>
      set((state) => ({
        escalations: state.escalations.map((e) =>
          e.id === id ? { ...e, status: "resolved" as const, resolvedBy: actor, resolvedAt: new Date().toISOString() } : e,
        ),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "escalation" as const,
            message: approve ? `Escalation approved by ${actor}` : `Escalation rejected by ${actor} — AI re-sourcing`,
            detail: state.escalations.find((e) => e.id === id)?.reason ?? "",
            loadId: state.escalations.find((e) => e.id === id)?.loadId,
            carrierId: PRIMARY_CARRIER_ID, severity: (approve ? "success" : "info") as ActivityEvent["severity"],
          },
          ...state.activity,
        ].slice(0, 80),
      })),

    routeEscalationToSupport: (id) =>
      set((state) => ({
        escalations: state.escalations.map((e) => (e.id === id ? { ...e, status: "with_support" as const } : e)),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "escalation" as const,
            message: "Routed to Backroute Support — a specialist is reviewing this now",
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
              content: "Nothing open to negotiate on right now — I'll push for the best number the moment I'm working a rate for you.",
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
        let events = result.events;
        if (result.truckUpdates) {
          const tu = result.truckUpdates;
          trucks = trucks.map((t) => (t.id === tu.id ? { ...t, ...tu } : t));
          if (tu.status === "available" && tu.currentLoadId === null) {
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
        const truck = state.trucks.find((t) => t.id === truckId);
        const incident = createIncident(driverId, PRIMARY_CARRIER_ID, truckId, truck?.currentLoadId ?? null, type, note);
        return {
          incidents: [incident, ...state.incidents],
          activity: [incidentOpenedEvent(incident, truck), ...state.activity].slice(0, 80),
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
              detail: `${serviceType} — AI will hold this truck out of the offer pool until service completes.`,
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
          message: `${kindLabel} DVIR ${overallStatus === "pass" ? "passed" : "flagged a defect"} — ${truck?.unitNumber ?? truckId}`,
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
              message: `Time off ${approve ? "approved" : "denied"} — ${driver?.name ?? "driver"}`,
              detail: `${request.startDate} – ${request.endDate}`,
              carrierId: PRIMARY_CARRIER_ID, severity: (approve ? "success" : "info") as ActivityEvent["severity"],
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
        const offers = createLoadOfferBatch(state.brokers, PRIMARY_CARRIER_ID, truck.id, state.tickCount, true, state.settings.offersPerTruck, {
          homeTimeTarget: driver?.homeTimeTarget,
          equipmentType: truck.equipmentType,
        });
        return {
          loads: [...offers, ...state.loads],
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "load_offered" as const,
              message: `Next-load options ready for ${truck.unitNumber}`,
              detail: `Pre-negotiating before delivery — ${offers.length} options found`,
              loadId: offers[0]?.id, carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),

    updateHomeTimeTarget: (driverId, target) =>
      set((state) => ({
        drivers: state.drivers.map((d) => (d.id === driverId ? { ...d, homeTimeTarget: target } : d)),
      })),

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
              message: `Load cancelled — ${broker?.company ?? load.source}`,
              detail: tonuFee ? `${reason} — TONU fee of ${formatCurrencyShort(tonuFee)} invoiced to broker` : reason,
              loadId, carrierId: load.carrierId, severity: (tonuFee ? "warning" : "info") as ActivityEvent["severity"],
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
            message: updated !== load ? "Broker responded to our ask — offer updated" : "Broker responded to our ask",
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
  },
}));

export const useStoreActions = () => useStore((s) => s.actions);
