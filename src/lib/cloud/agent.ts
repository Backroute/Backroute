import { authHeader } from "../ai/client";
import type { Item } from "./rows";
import { applyFromServer } from "./sync";

const REASON: Record<string, string> = {
  email_off: "Email isn't switched on yet, so the AI can't write to the broker.",
  not_offered: "That offer isn't open any more.",
  not_pending: "That load isn't waiting on the broker.",
  sign_in: "Only the office can do that. Sign in again if you're the owner.",
};

async function call(path: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { loads?: Item[]; trucks?: Item[]; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "failed" };
    if (data.loads?.length) applyFromServer("loads", data.loads);
    if (data.trucks?.length) applyFromServer("trucks", data.trucks);
    return { ok: true };
  } catch {
    return { ok: false, error: "offline" };
  }
}

/**
 * The owner picked an offer a broker emailed: the AI asks the broker to book it. When the rules can't price it (no
 * posted rate and no lowest rate per mile set), the owner types the price.
 */
export async function askToBook(loadId: string): Promise<string | null> {
  let r = await call("/api/agent/book", { loadId });
  if (!r.ok && r.error === "need_price") {
    const typed = window.prompt("The broker didn't post a rate, and no lowest rate per mile is set. What should the AI ask, all in ($)?");
    const ask = Number((typed ?? "").replace(/[$,\s]/g, ""));
    if (!(ask > 0)) return null;
    r = await call("/api/agent/book", { loadId, ask });
  }
  return r.ok ? null : (REASON[r.error] ?? "Couldn't do that. Check your connection and try again.");
}

/** The broker confirmed a load the AI asked for: it goes on the truck, and the driver gets the text. */
export async function markBooked(loadId: string): Promise<string | null> {
  const r = await call("/api/agent/booked", { loadId });
  return r.ok ? null : (REASON[r.error] ?? "Couldn't do that. Check your connection and try again.");
}
