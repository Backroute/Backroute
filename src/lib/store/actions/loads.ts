/** Loads: offers, booking, rate cons, the fleet, cancelling, reassigning and haggling with brokers. */
import { PRIMARY_CARRIER_ID } from "../../mock-data";
import { applyNegotiationInstruction, draftOfferAsk, finishBrokerCall, lineUpChoice, pushForBetterRate, resolveLoadOffer, resolveOfferAsk } from "../../engine";
import { makeBroker, makeLoad, makeTruckAndDriver } from "../../fleet";
import { formatDuration } from "../../utils";
import type { ActivityEvent, Load, VoiceCall } from "../../types";
import { formatCurrencyShort, scheduleCallEnds, uid, withLiveCall } from "../support";
import type { Actions, GetState, SetState } from "../state";
import { updateCall } from "../../dispatch-calls";

export const loadsActions = (set: SetState, get: GetState): Pick<Actions, "selectLoadOffer" | "saveRateConReading" | "setUpRealFleet" | "addToFleet" | "addLoad" | "requestBetterRate" | "cancelLoad" | "declineLoad" | "reassignTruck" | "requestOfferDetail" | "resolveOfferDetail" | "sendNegotiationInstruction" | "startBrokerCall" | "finishBrokerCall" | "logLoadVoiceCall" | "setDockAddress" | "setAiPaused"> => ({
  selectLoadOffer: (offerGroupId, loadId, actor) => {
    // A real account: the AI emails the broker to book it (lib/cloud/agent), and the load changes when that's done.
    if (get().session.mode !== "demo") {
      // Loaded when needed: it reaches back into the store through the sync.
      void import("../../cloud/agent").then((m) => m.askToBook(loadId)).then((problem) => problem && window.alert(problem));
      return;
    }
    set((state) => {
      const resolved = resolveLoadOffer(state.loads, offerGroupId, loadId, actor);
      const { loads, trucks } = lineUpChoice(state.trucks, resolved.loads, loadId);
      const events = resolved.events;
      return {
        loads,
        trucks,
        activity: [...events, ...state.activity].slice(0, 80),
      };
    });
  },

  saveRateConReading: (loadId, reading) =>
    set((state) => {
      const load = state.loads.find((l) => l.id === loadId);
      if (!load) return {};
      const serious = reading.mismatches.filter((m) => m.serious).length;
      const event: ActivityEvent = {
        id: uid("act"), timestamp: reading.readAt, type: "document_captured", loadId, carrierId: load.carrierId,
        message: !reading.isRateCon ? "Uploaded file isn't a rate con" : serious ? `Rate con doesn't match: ${serious} thing${serious === 1 ? "" : "s"} to fix` : "Rate con matches what was agreed",
        detail: `${reading.fileName} · read by AI`,
        severity: !reading.isRateCon || serious ? "warning" : "success",
      };
      return {
        loads: state.loads.map((l) => (l.id === loadId ? { ...l, rateConReading: reading, updatedAt: new Date().toISOString() } : l)),
        activity: [event, ...state.activity].slice(0, 80),
      };
    }),

  setUpRealFleet: (entries) => {
    const made = entries.map(makeTruckAndDriver);
    const ours = <T extends { carrierId?: string }>(list: T[]) => list.filter((x) => x.carrierId !== PRIMARY_CARRIER_ID);
    set((state) => ({
      trucks: made.map((m) => m.truck),
      drivers: made.map((m) => m.driver),
      loads: ours(state.loads),
      escalations: ours(state.escalations),
      // The sample customers (direct shippers) are the carrier's own; the shared sample brokers stay.
      brokers: ours(state.brokers),
      activity: [],
      dispatchCalls: [],
      driverMessages: [],
      carrierMessages: [],
      incidents: [],
      maintenanceAppointments: [],
      dvirInspections: [],
      timeOffRequests: [],
      expenses: [],
      fuelTx: [],
      tollTx: [],
      payRuns: [],
      advances: [],
    }));
    return made.map((m) => m.driver);
  },

  addToFleet: (entries) => {
    const made = entries.map(makeTruckAndDriver);
    set((state) => ({ trucks: [...state.trucks, ...made.map((m) => m.truck)], drivers: [...state.drivers, ...made.map((m) => m.driver)] }));
  },

  addLoad: ({ brokerName, brokerEmail, rateConReading, ...input }) => {
    const state = get();
    const truck = state.trucks.find((t) => t.id === input.truckId)!;
    const existing = state.brokers.find((b) => b.carrierId === PRIMARY_CARRIER_ID && b.company.toLowerCase() === brokerName.trim().toLowerCase());
    const broker = existing ?? makeBroker(brokerName, brokerEmail);
    // The truck's first load is dispatched right away; one behind it waits as the next load.
    const first = !truck.currentLoadId;
    const load: Load = {
      ...makeLoad({ ...input, brokerId: broker.id }, broker, truck, first ? "dispatched" : "booked"),
      ...(rateConReading ? { rateConReading } : {}),
      ...(brokerEmail?.trim() ? { brokerContactEmail: brokerEmail.trim() } : {}),
    };
    const event: ActivityEvent = {
      id: uid("act"), timestamp: load.createdAt, type: "booked", loadId: load.id, carrierId: PRIMARY_CARRIER_ID,
      message: `Load added: ${load.lane.origin} → ${load.lane.destination}`,
      detail: `${truck.unitNumber} · ${broker.company} · $${(load.bookedRate ?? 0).toLocaleString()}${rateConReading ? " · from the rate con" : ""}`,
      severity: "success",
    };
    set((s) => ({
      brokers: existing ? s.brokers : [...s.brokers, broker],
      loads: [load, ...s.loads],
      trucks: s.trucks.map((t) =>
        t.id !== truck.id ? t : first ? { ...t, currentLoadId: load.id, status: "on_load" as const } : t.nextLoadId ? t : { ...t, nextLoadId: load.id },
      ),
      activity: [event, ...s.activity].slice(0, 80),
    }));
    return load;
  },

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
      // The driver hears it from dispatch before they roll up to a dock that isn't expecting them.
      const driver = state.drivers.find((d) => d.id === state.trucks.find((t) => t.id === load.truckId)?.driverId);
      const tell = driver && ["rate_confirmed", "booked", "dispatched", "at_pickup"].includes(load.stage) ? updateCall(driver, load, "cancelled", { tonu: tonuFee || undefined }) : null;

      return {
        ...(tell ? { dispatchCalls: [tell, ...state.dispatchCalls] } : {}),
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

  setDockAddress: (loadId, stop, address) =>
    set((state) => ({
      loads: state.loads.map((l) => {
        if (l.id !== loadId) return l;
        const key = stop === "pickup" ? "pickupAddress" : "deliveryAddress";
        const next = { ...l, updatedAt: new Date().toISOString() };
        if (address.trim()) next[key] = address.trim().slice(0, 200);
        else delete next[key];
        return next;
      }),
    })),

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
});
