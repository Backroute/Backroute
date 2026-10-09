/** Settings, autopilot, broker calls the owner makes, home time, and support's overrides. */
import { PRIMARY_CARRIER_ID } from "../../mock-data";
import { computeEconomics, computeLoadScore } from "../../scoring";
import { HOME_TIME_OPTIONS, laneFits, RUN_TYPE_DETAIL, RUN_TYPE_LABEL } from "../../run-types";
import type { ActivityEvent, Load } from "../../types";
import { AUTONOMY_DETAIL, AUTONOMY_LABEL } from "../settings";
import { autoPickOffer, payFor, uid } from "../support";
import type { Actions, SetState } from "../state";

export const preferencesActions = (set: SetState): Pick<Actions, "updateSettings" | "logDriverCheckIn" | "setHomePriority" | "setBrokerPolicy" | "setAutonomy" | "toggleAddon" | "updateHomeTimeTarget" | "setRunType" | "opsOverrideRate" | "opsSetBrokerTier" | "opsToggleCarrierFlag"> => ({
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
            message: on ? `Backroute will get ${driver?.name.split(" ")[0] ?? "the driver"} home first` : `Backroute is back to best-paying loads for ${driver?.name.split(" ")[0] ?? "the driver"}`,
            detail: on ? "Backroute only books loads that bring them closer to home, even at a lower rate." : "Home time is still checked before every load.",
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
            message: policy === "block" ? `Backroute won't book ${broker?.company ?? "this broker"} anymore` : policy === "surcharge" ? `Backroute will ask ${broker?.company ?? "this broker"} for a slow-pay premium` : `Backroute is back to its own call on ${broker?.company ?? "this broker"}`,
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
});
