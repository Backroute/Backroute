/** Chat with drivers and the owner, and what happens to items in Needs you. */
import { PRIMARY_CARRIER_ID } from "../../mock-data";
import { applyNegotiationInstruction, classifyInstruction } from "../../engine";
import { askAi, setTyping } from "../../ai/client";
import { driverSnapshot, ownerSnapshot } from "../../ai/snapshot";
import type { ActivityEvent, CarrierMessage, DriverMessage } from "../../types";
import { AUTONOMY_LABEL } from "../settings";
import { NEGOTIATION_REPLY, craftCarrierReply, craftDriverReply, findNegotiatingLoadForDriver, rateConDecision, uid } from "../support";
import type { Actions, GetState, SetState } from "../state";

export const messagesActions = (set: SetState, get: GetState): Pick<Actions, "resolveEscalation" | "routeEscalationToSupport" | "sendDriverMessage" | "sendCarrierMessage"> => ({
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
          ? { ...e, status: "resolved" as const, resolvedBy: actor, resolvedAt: new Date().toISOString(), resolutionNote: note || undefined, approved: approve }
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
    const thread = `driver:${driverId}`;
    setTyping(thread, true);

    // Telling the AI what to do on a rate it's negotiating is an action, handled here. Everything else is a
    // question: the real AI answers when it's available, and the scripted reply covers when it isn't.
    const before = get();
    const negotiating = findNegotiatingLoadForDriver(before, driverId) && classifyInstruction(content) !== "general";
    const history = before.driverMessages.filter((m) => m.driverId === driverId && m.id !== msg.id).slice(-12);
    const asked = negotiating
      ? Promise.resolve(null)
      : askAi({
          role: "driver",
          question: content,
          history: history.map((m) => ({ from: m.from === "driver" ? "user" : "ai", text: m.content })),
          snapshot: driverSnapshot(before, driverId),
        });

    void asked.then((answer) => {
      if (answer) {
        const reply: DriverMessage = { id: uid("dm"), driverId, from: "ai", content: answer, timestamp: new Date().toISOString(), ai: true };
        set((state) => ({ driverMessages: [...state.driverMessages, reply] }));
        setTyping(thread, false);
        return;
      }
      setTimeout(() => {
        setTyping(thread, false);
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
      }, 700 + Math.random() * 800);
    });
  },

  sendCarrierMessage: (carrierId, content) => {
    const msg: CarrierMessage = { id: uid("cm"), carrierId, from: "carrier", content, timestamp: new Date().toISOString() };
    set((state) => ({ carrierMessages: [...state.carrierMessages, msg] }));
    const thread = `owner:${carrierId}`;
    setTyping(thread, true);

    const before = get();
    const history = before.carrierMessages.filter((m) => m.carrierId === carrierId && m.id !== msg.id).slice(-12);
    void askAi({
      role: "owner",
      question: content,
      history: history.map((m) => ({ from: m.from === "carrier" ? "user" : "ai", text: m.content })),
      snapshot: ownerSnapshot(before, AUTONOMY_LABEL),
    }).then((answer) => {
      if (answer) {
        const reply: CarrierMessage = { id: uid("cm"), carrierId, from: "ai", content: answer, timestamp: new Date().toISOString(), ai: true };
        set((state) => ({ carrierMessages: [...state.carrierMessages, reply] }));
        setTyping(thread, false);
        return;
      }
      setTimeout(() => {
        setTyping(thread, false);
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
      }, 700 + Math.random() * 800);
    });
  },
});
