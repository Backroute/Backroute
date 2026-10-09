/** The AI's phone calls to drivers: answering, replying, hanging up, the owner taking over. */
import { computeDriverPay } from "../../settlements";
import { pack } from "../../lang";
import { weekEarnings } from "../../earnings";
import { KIND_LABEL, inboundCall, OWNER_NAME, setupCall } from "../../dispatch-calls";
import type { DispatchCall } from "../../types";
import { answerCall, callDraftResult, callEvent, draftFrom, endCall, openingFor, patchCall, readersOf, replyToCall, textInstead, trFor } from "../calls";
import type { Actions, SetState } from "../state";

export const callsActions = (set: SetState): Pick<Actions, "answerDispatchCall" | "declineDispatchCall" | "replyDispatchCall" | "hangUpDispatchCall" | "setDutyStatus" | "setDriverPrefs" | "startSetupCall" | "startInboundCall" | "takeOverDispatchCall" | "ownerSayOnCall"> => ({
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
      callEvent(d, call, `${OWNER_NAME} took over a dispatch call with ${first}`, KIND_LABEL[call.kind]);
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
});
