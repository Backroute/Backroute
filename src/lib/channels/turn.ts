import "server-only";
import { brokerCallReply } from "../agent/broker-call";
import type { CarrierContext } from "../agent/db";
import { shopCallReply } from "../agent/roadside";
import { driverCallReply, ownerCallReply } from "./voice";

export type TurnKind = "driver" | "broker" | "shop" | "owner";

/**
 * One turn of a phone call: what the other person just said, and what the AI says back (and whether it hangs up).
 * The same AI, tools and rules for the voice server's natural calls and the simulator's.
 */
export async function callTurn(ctx: CarrierContext, kind: TurnKind, ref: string, callSid: string, said: string, data: Record<string, unknown> = {}): Promise<{ reply: string; hangUp: boolean }> {
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
  const truck = ctx.trucks.find((t) => t.id === ref);
  if (!truck?.roadside) return { reply: "Sorry, wrong number. Thanks.", hangUp: true };
  return shopCallReply(ctx, truck, callSid, said);
}
