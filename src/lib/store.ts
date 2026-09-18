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
import { clamp } from "./utils";
import type {
  ActivityEvent,
  Broker,
  Carrier,
  Driver,
  DriverMessage,
  Escalation,
  Incident,
  IncidentType,
  Load,
  Truck,
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
  incidents: Incident[];
  settings: AgentSettings;
  liveMetrics: LiveMetrics;
  tickCount: number;
  actions: {
    tick: () => void;
    resolveEscalation: (id: string, approve: boolean, actor?: "carrier" | "ops") => void;
    routeEscalationToSupport: (id: string) => void;
    sendDriverMessage: (driverId: string, content: string) => void;
    updateSettings: (partial: Partial<AgentSettings>) => void;
    driverConfirmStage: (loadId: string) => void;
    recaptureDocument: (loadId: string, type: "bol" | "pod") => void;
    selectLoadOffer: (offerGroupId: string, loadId: string, actor: "driver" | "carrier") => void;
    reportIncident: (driverId: string, truckId: string, type: IncidentType, note: string) => void;
    seedInitialOffers: () => void;
    updateHomeTimeTarget: (driverId: string, target: string) => void;
    requestBetterRate: (loadId: string, actor: "driver" | "carrier", amount?: number) => void;
    /** Ask the AI a question about a pending offer before committing — detention, schedule, payment terms, anything but rate (the AI already set that from data; pushing further belongs to post-selection negotiation). Phase one logs the ask and returns what to show; `resolved` true means there's nothing to wait on. */
    requestOfferDetail: (loadId: string, text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
    /** Phase two: the broker's actual answer to a non-rate ask. */
    resolveOfferDetail: (loadId: string, draft: OfferAskDraft) => string;
    sendNegotiationInstruction: (loadId: string, actor: "driver" | "carrier", text: string) => void;
    setAiPaused: (loadId: string, paused: boolean) => void;
    opsOverrideRate: (loadId: string, amount: number) => void;
    toggleAddon: (addonId: string) => void;
  };
}

const world = generateWorld();

function craftDriverReply(content: string): string {
  const c = content.toLowerCase();
  if (c.includes("eta") || c.includes("time")) return "You're tracking on time — I'll ping you if that changes based on traffic or weather.";
  if (c.includes("fuel")) return "Noted — nearest in-network fuel stop is 12 miles ahead, best price on your card today.";
  if (c.includes("detention") || c.includes("wait") || c.includes("late")) return "Logging the delay now. I'll open a detention claim with the broker if you're over 2 hours.";
  if (c.includes("load") || c.includes("next")) return "Already working your next load so you don't run empty — I'll confirm the rate as soon as it's locked.";
  if (c.includes("doc") || c.includes("pod") || c.includes("bol")) return "Got it — snap a photo in the Documents tab and I'll verify and file it automatically.";
  return "Got it, thanks for the update — I've logged it and will keep you posted.";
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

        const activeLoads = loads.filter((l) => l.stage !== "delivered" && l.stage !== "declined" && l.carrierId === PRIMARY_CARRIER_ID);

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
            l.stage !== "delivered" && l.stage !== "declined" && l.stage !== "offered" &&
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
        escalations: state.escalations.map((e) => (e.id === id ? { ...e, status: "resolved" as const, resolvedBy: actor } : e)),
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

          const reply: DriverMessage = { id: uid("dm"), driverId, from: "ai", content: craftDriverReply(content), timestamp: new Date().toISOString() };
          return { driverMessages: [...state.driverMessages, reply] };
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
