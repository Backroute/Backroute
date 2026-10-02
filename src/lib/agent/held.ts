import "server-only";
import { randomBytes } from "crypto";
import type { Item } from "../cloud/rows";
import type { DraftMessage, Escalation, Load } from "../types";
import { addActivity, admin, loadContext, save, type CarrierContext } from "./db";
import { event, passToOwner } from "./dispatcher";
import { addWhy } from "./why";

/**
 * A moment to change your mind: an email the AI wrote on its own to book, counter or accept a load waits a little
 * (settings.undoSeconds, 90 by default) before it goes. The owner sees it in the app with Undo; stopped, nothing
 * goes and the load is put back the way it was (or, for an answer to the broker's number, left for the owner to
 * answer). Sent by a short wait after the request that wrote it, and by the dispatcher's rounds if that wait was
 * cut off. What the owner sends themselves, or approves, goes at once.
 */

export const HELD_PURPOSES = new Set(["book_request", "counter", "accept"]);
/** Seconds to wait (UNDO_SECONDS sets the default for every carrier; a carrier's own setting wins). */
export const undoWindow = (settings: Pick<CarrierContext["settings"], "undoSeconds" | "sandbox">) =>
  settings.sandbox ? 0 : Math.max(0, Math.min(600, settings.undoSeconds ?? Number(process.env.UNDO_SECONDS ?? 90)));

export interface HeldSend {
  id: string;
  loadId: string | null;
  purpose: string;
  summary: string;
  sendAt: string;
  status: "held" | "sending" | "sent" | "stopped" | "failed";
}

const SUMMARY: Record<string, (d: DraftMessage, load?: Load) => string> = {
  book_request: (d, l) => `Asking ${d.toName ?? d.to} to book ${l ? `${l.lane.origin} → ${l.lane.destination}` : "a load"} at $${(d.amount ?? 0).toLocaleString()}`,
  counter: (d, l) => `Countering ${d.toName ?? d.to} at $${(d.amount ?? 0).toLocaleString()}${l ? ` on ${l.referenceNumber}` : ""}`,
  accept: (d, l) => `Accepting $${(d.amount ?? 0).toLocaleString()} from ${d.toName ?? d.to}${l ? ` on ${l.referenceNumber}` : ""}`,
};

/** Holds a draft for the undo window. Returns its id. */
export async function hold(ctx: CarrierContext, draft: DraftMessage, loadId: string | undefined, seconds: number): Promise<string> {
  const id = `hs_${randomBytes(8).toString("hex")}`;
  const load = loadId ? ctx.loads.find((l) => l.id === loadId) : undefined;
  const summary = (SUMMARY[draft.purpose ?? ""] ?? ((d: DraftMessage) => `Emailing ${d.toName ?? d.to}`))(draft, load);
  const { error } = await admin()
    .from("held_sends")
    .insert({ id, carrier_id: ctx.carrier.id, load_id: loadId ?? null, purpose: draft.purpose ?? "reply", summary, draft, send_at: new Date(Date.now() + seconds * 1000).toISOString() });
  if (error) throw error;
  // Sent after the wait from here when the platform keeps the request alive for it; the rounds catch the rest.
  try {
    const { after } = await import("next/server");
    after(async () => {
      await new Promise((r) => setTimeout(r, seconds * 1000 + 500));
      await release(id).catch((e) => console.error("[held] couldn't send", e));
    });
  } catch {
    // Outside a request (a script): the rounds send it.
  }
  return id;
}

/** Sends one held email if it's due and still held. Claimed atomically, so it goes once. */
export async function release(id: string, now = Date.now()): Promise<boolean> {
  const db = admin();
  const { data: claimed } = await db.from("held_sends").update({ status: "sending" }).eq("id", id).eq("status", "held").lte("send_at", new Date(now + 1000).toISOString()).select("carrier_id, load_id, draft").maybeSingle();
  if (!claimed) return false;
  try {
    const ctx = await loadContext(claimed.carrier_id as string);
    if (!ctx) throw new Error("no carrier");
    // Paused: it waits (the owner can still stop it). Its time stays as it was, so it goes on the first round after
    // they resume.
    if (ctx.settings.paused) {
      await db.from("held_sends").update({ status: "held" }).eq("id", id);
      return false;
    }
    const { deliver } = await import("./outbox");
    await deliver(ctx, claimed.draft as DraftMessage, (claimed.load_id as string) ?? undefined, { auto: true });
    await db.from("held_sends").update({ status: "sent" }).eq("id", id);
    return true;
  } catch (e) {
    // Back in line for the next round.
    await db.from("held_sends").update({ status: "held", send_at: new Date(now + 60_000).toISOString() }).eq("id", id);
    throw e;
  }
}

/** The rounds: everything whose wait is over (a wait that was cut off). */
export async function releaseDue(now = Date.now()): Promise<number> {
  const { data } = await admin().from("held_sends").select("id").eq("status", "held").lte("send_at", new Date(now).toISOString()).order("send_at").limit(50);
  let sent = 0;
  for (const r of data ?? []) if (await release(r.id as string, now).catch((e) => (console.error("[held] round send failed", e), false))) sent++;
  return sent;
}

/** What's waiting to go for a carrier, soonest first. */
export async function heldFor(carrierId: string): Promise<HeldSend[]> {
  const { data } = await admin().from("held_sends").select("id, load_id, purpose, summary, send_at, status").eq("carrier_id", carrierId).eq("status", "held").order("send_at").limit(20);
  return (data ?? []).map((r) => ({ id: r.id as string, loadId: (r.load_id as string) ?? null, purpose: r.purpose as string, summary: r.summary as string, sendAt: r.send_at as string, status: r.status as HeldSend["status"] }));
}

/**
 * The owner stopped it. A book request puts the load back with its offers; a counter or acceptance leaves the
 * broker's number for the owner to answer (from the load's negotiation box).
 */
export async function stop(carrierId: string, id: string, by: string | null): Promise<{ stopped: boolean; note?: string }> {
  const db = admin();
  const { data: row } = await db.from("held_sends").update({ status: "stopped", stopped_by: by }).eq("id", id).eq("carrier_id", carrierId).eq("status", "held").select("load_id, purpose, summary, draft").maybeSingle();
  if (!row) return { stopped: false };
  const ctx = await loadContext(carrierId);
  if (!ctx) return { stopped: true };
  const draft = row.draft as DraftMessage;
  const load = row.load_id ? ctx.loads.find((l) => l.id === row.load_id) : undefined;
  let note = "Stopped. Nothing went to the broker.";
  if (load && row.purpose === "book_request") {
    const asked = load.bookRequest?.askedAt;
    const back: Load = addWhy({ ...load, stage: "offered", bookRequest: undefined, updatedAt: new Date().toISOString() }, "You stopped the AI's request to book this one before it went.");
    await save("loads", carrierId, back as unknown as Item);
    // The offers set aside when the AI picked this one come back too.
    for (const l of ctx.loads)
      if (l.id !== load.id && l.offerGroupId && l.offerGroupId === load.offerGroupId && l.stage === "declined" && asked && l.updatedAt === asked)
        await save("loads", carrierId, { ...l, stage: "offered", updatedAt: new Date().toISOString() } as unknown as Item);
    note = "Stopped. The load is back with its offers.";
  } else if (load) {
    const offer = load.bookRequest?.brokerOffer;
    await save("loads", carrierId, addWhy(load, `You stopped the AI's ${row.purpose === "accept" ? "acceptance" : "counter"} before it went.`) as unknown as Item);
    const e: Escalation | null = await passToOwner(ctx, {
      reason: `You stopped the AI's ${row.purpose === "accept" ? `acceptance of $${(draft.amount ?? 0).toLocaleString()}` : `counter at $${(draft.amount ?? 0).toLocaleString()}`} on ${load.referenceNumber}.${offer ? ` The broker's offer of $${offer.toLocaleString()} is still waiting for an answer.` : ""} Tell the AI what to do from the load.`,
      loadId: load.id,
      label: "I'll answer",
      source: "email",
      to: "owner",
    });
    void e;
    note = "Stopped. The broker's offer is waiting for your answer on the load.";
  }
  await addActivity(carrierId, event({ type: "escalation", loadId: load?.id, message: `You stopped: ${row.summary as string}`, severity: "info" }));
  return { stopped: true, note };
}
