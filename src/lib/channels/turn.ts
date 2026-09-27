import "server-only";
import { brokerCallReply } from "../agent/broker-call";
import type { CarrierContext } from "../agent/db";
import { shopCallReply } from "../agent/roadside";
import { facilityCallReply, type Stop } from "../agent/appointments";
import { press, updateCall } from "./twilio";
import { streamXml } from "./realtime";
import type { CallReply } from "./ivr";
import { forCarrier } from "../agent/scope";
import { driverCallReply, ownerCallReply } from "./voice";

export type TurnKind = "driver" | "broker" | "shop" | "owner" | "facility";

/**
 * One turn of a phone call: what the other person just said, and what the AI says back (and whether it hangs up).
 * The same AI, tools and rules for the voice server's natural calls and the simulator's.
 */
export function callTurn(ctx: CarrierContext, kind: TurnKind, ref: string, callSid: string, said: string, data: Record<string, unknown> = {}): Promise<CallReply> {
  return forCarrier(ctx.carrier.id, () => turn(ctx, kind, ref, callSid, said, data));
}

async function turn(ctx: CarrierContext, kind: TurnKind, ref: string, callSid: string, said: string, data: Record<string, unknown>): Promise<CallReply> {
  const reply = await answer(ctx, kind, ref, callSid, said, data);
  // A natural call hit a phone menu: the key press goes into the live call, which then comes back to the voice server
  // listening quietly (as on hold) until a person picks up.
  if (reply.digits && data.realtime) {
    try {
      await updateCall(callSid, streamXml({ kind, carrier: ctx.carrier.id, ref, callSid, lang: "en", opening: "", hold: true }, press(reply.digits)));
      return { reply: "", hangUp: false, redirected: true };
    } catch (e) {
      console.error("[call] couldn't press the key", e);
      return { reply: "", hangUp: false, hold: true };
    }
  }
  return reply;
}

async function answer(ctx: CarrierContext, kind: TurnKind, ref: string, callSid: string, said: string, data: Record<string, unknown>): Promise<CallReply> {
  if (kind === "driver") {
    const driver = ctx.drivers.find((d) => d.id === ref);
    if (!driver) return { reply: "Sorry, I can't find you on file. Please call your carrier.", hangUp: true };
    return driverCallReply(ctx.carrier.id, driver, callSid, said, data);
  }
  if (kind === "owner") return ownerCallReply(ctx.carrier.id, callSid, said, data);
  if (kind === "broker") {
    const load = ctx.loads.find((l) => l.id === ref);
    if (!load) return { reply: "Sorry, I'll follow up by email. Thanks.", hangUp: true };
    return brokerCallReply(ctx, load, callSid, said, data);
  }
  if (kind === "facility") {
    // ref is "<load id>:<pickup|delivery>".
    const [loadId, stop] = ref.split(":");
    const load = ctx.loads.find((l) => l.id === loadId);
    if (!load || (stop !== "pickup" && stop !== "delivery")) return { reply: "Sorry, wrong number. Thanks.", hangUp: true };
    return facilityCallReply(ctx, load, stop as Stop, callSid, said);
  }
  const truck = ctx.trucks.find((t) => t.id === ref);
  if (!truck?.roadside) return { reply: "Sorry, wrong number. Thanks.", hangUp: true };
  return shopCallReply(ctx, truck, callSid, said);
}
