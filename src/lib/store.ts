import { create } from "zustand";
import { generateWorld, PRIMARY_CARRIER_ID } from "./mock-data";
import { advanceLoad, createSourcedLoad, shouldChainNextLoad } from "./engine";
import { clamp } from "./utils";
import type {
  ActivityEvent,
  Broker,
  Carrier,
  Driver,
  DriverMessage,
  Escalation,
  Load,
  Truck,
} from "./types";

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

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
}

export interface LiveMetrics {
  activeCalls: number;
  activeSmsThreads: number;
  activeEmailThreads: number;
  loadsScannedToday: number;
  boardsConnected: number;
}

const ESCALATION_REASONS = [
  "Broker requesting rate 8% below carrier floor — needs human approval to accept or walk.",
  "Receiver requesting appointment change outside driver's HOS window.",
  "Detention exceeding 2 hours — approve detention invoice to shipper.",
  "Broker unresponsive after 45 minutes — recommend re-sourcing the lane.",
  "Weight discrepancy at scale — confirm accessorial with broker.",
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
  settings: AgentSettings;
  liveMetrics: LiveMetrics;
  tickCount: number;
  actions: {
    tick: () => void;
    resolveEscalation: (id: string, approve: boolean) => void;
    sendDriverMessage: (driverId: string, content: string) => void;
    updateSettings: (partial: Partial<AgentSettings>) => void;
    captureDocument: (loadId: string, type: "bol" | "pod") => void;
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

export const useStore = create<StoreState>((set) => ({
  ...world,
  settings: {
    aggressiveness: "balanced",
    autoBookEnabled: true,
    autoBookThreshold: 350,
    voiceEnabled: true,
    smsEnabled: true,
    emailEnabled: true,
    tmsProvider: "McLeod Software",
    tmsConnected: true,
    notifyEmail: true,
    notifySms: false,
    rateFloorPct: 96,
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
        const newEvents: ActivityEvent[] = [];

        const activeLoads = loads.filter((l) => l.stage !== "delivered" && l.carrierId === PRIMARY_CARRIER_ID);
        const availableTrucks = trucks.filter((t) => t.status === "available" && !t.nextLoadId);

        if (activeLoads.length < 13 && Math.random() < 0.42) {
          const preassign = availableTrucks.length && Math.random() < 0.25 ? pick(availableTrucks) : null;
          const newLoad = createSourcedLoad(state.brokers, PRIMARY_CARRIER_ID, state.tickCount, preassign?.id ?? null, false);
          loads = [newLoad, ...loads];
          newEvents.push({
            id: uid("act"), timestamp: new Date().toISOString(), type: "load_sourced",
            message: "New load sourced", detail: `${newLoad.source} · ${newLoad.lane.origin} → ${newLoad.lane.destination} · $${newLoad.listedRate.toLocaleString()}`,
            loadId: newLoad.id, carrierId: PRIMARY_CARRIER_ID, severity: "info",
          });
        }

        const candidates = loads.filter((l) => l.stage !== "delivered" && l.carrierId === PRIMARY_CARRIER_ID);
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
              const truckAfter = trucks.find((t) => t.id === tu.id);
              if (truckAfter?.nextLoadId) {
                const chainedId = truckAfter.nextLoadId;
                trucks = trucks.map((t) => (t.id === tu.id ? { ...t, currentLoadId: chainedId, nextLoadId: null } : t));
                newEvents.push({
                  id: uid("act"), timestamp: new Date().toISOString(), type: "chained",
                  message: "Next load already chained — zero empty miles", detail: `${truckAfter.unitNumber} rolling straight into the next lane`,
                  loadId: chainedId, carrierId: PRIMARY_CARRIER_ID, severity: "success",
                });
              }
            }
          }

          if (effectiveTruck && shouldChainNextLoad(result.load, effectiveTruck)) {
            const chained = createSourcedLoad(state.brokers, PRIMARY_CARRIER_ID, state.tickCount + 1, effectiveTruck.id, true);
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
          const esc: Escalation = {
            id: uid("esc"), loadId: target.id, carrierId: PRIMARY_CARRIER_ID,
            reason: pick(ESCALATION_REASONS), createdAt: new Date().toISOString(), status: "open",
          };
          escalations = [esc, ...escalations];
          newEvents.push({
            id: uid("act"), timestamp: new Date().toISOString(), type: "escalation",
            message: "Escalated for human approval", detail: esc.reason, loadId: target.id, carrierId: PRIMARY_CARRIER_ID, severity: "warning",
          });
        }

        const step = (v: number, min: number, max: number, jitter = 2) => clamp(v + randInt(-jitter, jitter), min, max);

        return {
          loads,
          trucks,
          escalations,
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

    resolveEscalation: (id, approve) =>
      set((state) => ({
        escalations: state.escalations.map((e) => (e.id === id ? { ...e, status: "resolved" as const } : e)),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "escalation" as const,
            message: approve ? "Escalation approved by carrier" : "Escalation rejected — AI re-sourcing",
            detail: state.escalations.find((e) => e.id === id)?.reason ?? "",
            loadId: state.escalations.find((e) => e.id === id)?.loadId,
            carrierId: PRIMARY_CARRIER_ID, severity: (approve ? "success" : "info") as ActivityEvent["severity"],
          },
          ...state.activity,
        ].slice(0, 80),
      })),

    sendDriverMessage: (driverId, content) => {
      const msg: DriverMessage = { id: uid("dm"), driverId, from: "driver", content, timestamp: new Date().toISOString() };
      set((state) => ({ driverMessages: [...state.driverMessages, msg] }));
      setTimeout(() => {
        const reply: DriverMessage = { id: uid("dm"), driverId, from: "ai", content: craftDriverReply(content), timestamp: new Date().toISOString() };
        set((state) => ({ driverMessages: [...state.driverMessages, reply] }));
      }, 1100 + Math.random() * 1000);
    },

    updateSettings: (partial) => set((state) => ({ settings: { ...state.settings, ...partial } })),

    captureDocument: (loadId, type) =>
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load) return {};
        const doc = {
          id: uid("doc"),
          type,
          name: `${type.toUpperCase()}_${load.referenceNumber}_${randInt(1, 99)}.jpg`,
          generatedAt: new Date().toISOString(),
          status: "verified" as const,
        };
        return {
          loads: state.loads.map((l) => (l.id === loadId ? { ...l, documents: [...l.documents, doc] } : l)),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "document_captured" as const,
              message: `${type.toUpperCase()} captured by driver`, detail: `${load.referenceNumber} · verified automatically`,
              loadId, carrierId: load.carrierId, severity: "success" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      }),
  },
}));

export const useStoreActions = () => useStore((s) => s.actions);
