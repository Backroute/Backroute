/**
 * The app's store (zustand): the fleet, loads, messages and settings the screens show, and the actions they take.
 * The demo runs entirely here; a real account syncs it with the database (lib/cloud). Split by topic:
 * settings.ts and state.ts are the types, support.ts and calls.ts the shared helpers, actions/ the actions.
 */
import { create } from "zustand";
import { DEFAULT_ENABLED_ADDONS } from "../addons";
import type { StoreState } from "./state";
import { world } from "./support";
import { simulationActions } from "./actions/simulation";
import { messagesActions } from "./actions/messages";
import { preferencesActions } from "./actions/preferences";
import { tripActions } from "./actions/trip";
import { callsActions } from "./actions/calls";
import { loadsActions } from "./actions/loads";

export { AUTONOMY_DETAIL, AUTONOMY_LABEL, readLangOf } from "./settings";
export type { AgentSettings, Aggressiveness, Autonomy } from "./settings";
export type { DriverDocType } from "./state";

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
    ...simulationActions(set, get),
    ...messagesActions(set, get),
    ...preferencesActions(set),
    ...tripActions(set, get),
    ...callsActions(set),
    ...loadsActions(set, get),
  },
}));
