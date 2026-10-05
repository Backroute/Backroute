/** The demo's clock: each tick moves the sample fleet's loads, offers, calls and incidents along. */
import { PRIMARY_CARRIER_ID } from "../../mock-data";
import { advanceIncident, advanceLoad, autoResolveStaleOffers, createLoadOfferBatch, createSourcedLoad, lineUpChoice, pickLaneNear, replacePlanLeg, shouldChainNextLoad } from "../../engine";
import { dockClock } from "../../detention";
import { bookableBrokers } from "../../broker-policy";
import { type EmptyAt, updateCall } from "../../dispatch-calls";
import { clamp } from "../../utils";
import type { ActivityEvent, Broker, Escalation, Load } from "../../types";
import { CallDraft, draftFrom, runDispatchCalls } from "../calls";
import { ESCALATION_TEMPLATES, autoPickOffer, fitsDriver, homeOptions, pick, promoteChainedLoad, randInt, runRateCons, scheduleCallEnds, uid, withLiveCall } from "../support";
import type { Actions, GetState, SetState } from "../state";

export const simulationActions = (set: SetState, get: GetState): Pick<Actions, "tick" | "seedInitialOffers"> => ({
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
      const planNews: { dropped: Load; replacement: Load }[] = [];

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
          // A team truck rolls through the night; a solo driver starts from the hours they have left today.
          crew: { team: !!truck.secondDriverId, driveLeft: driver?.hoursRemaining },
        });
        loads = [...offers, ...loads];
        if (truck.autoChainNextLoad) {
          const picked = autoPickOffer(loads, trucks, offers, truck.id);
          loads = picked.loads;
          trucks = picked.trucks;
          newEvents.push(...picked.events);
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
            crew: { team: !!truck.secondDriverId },
          });
          loads = [...offers, ...loads];
          if (truck.autoChainNextLoad) {
            const picked = autoPickOffer(loads, trucks, offers, truck.id);
            loads = picked.loads;
            trucks = picked.trucks;
            newEvents.push(...picked.events);
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
          if (!ev.loadId) continue;
          const lined = lineUpChoice(trucks, loads, ev.loadId);
          loads = lined.loads;
          trucks = lined.trucks;
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
        // A broker in a plan gave their load to someone else: the AI finds another so the plan still runs.
        if (result.load.stage === "declined" && target.stage !== "declined" && result.load.plan) {
          const replaced = replacePlanLeg(result.load, loads, trucks, bookable, state.tickCount + 7, surcharges);
          if (replaced) {
            loads = replaced.loads;
            trucks = replaced.trucks;
            newEvents.push(replaced.event);
            planNews.push({ dropped: result.load, replacement: replaced.loads[0] });
          }
        }

        if (result.truckUpdates) {
          const tu = result.truckUpdates;
          trucks = trucks.map((t) => (t.id === tu.id ? { ...t, ...tu } : t));

          if (tu.status === "available" && tu.currentLoadId === null) {
            trucks = trucks.map((t) => (t.id === tu.id ? { ...t, lastDeliveredLoadId: result.load.id } : t));
            const promoted = promoteChainedLoad(trucks, tu.id, PRIMARY_CARRIER_ID, loads);
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
      // Booked for them (by the AI or the owner): the driver hears it on a call once the broker confirms (store/calls).
      // A load in their plan fell through and another took its place: they hear that too.
      for (const { dropped, replacement } of planNews) {
        const driver = draft.drivers.find((x) => x.id === trucks.find((t) => t.id === (replacement.truckId ?? dropped.truckId))?.driverId);
        if (driver) draft.dispatchCalls = [updateCall(driver, dropped, "replaced", { replacement }), ...draft.dispatchCalls];
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
        crew: { team: !!truck.secondDriverId },
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
});
