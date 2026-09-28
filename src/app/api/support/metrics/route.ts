import { admin, dbConfigured } from "@/lib/agent/db";
import { supportCaller } from "@/lib/agent/support";
import { handoffKind, SLA_MINUTES, type HandoffKind } from "@/lib/support-playbooks";
import type { Escalation } from "@/lib/types";

/**
 * How much still needs people, for the last 7 and 30 days: hand-offs by kind, per truck per week, how fast support
 * closes them, and how many ran late. The number that should keep going down is hand-offs per truck per week.
 */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  if (!(await supportCaller(request))) return Response.json({ error: "support_only" }, { status: 403 });
  const db = admin();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: rows }, { data: trucks }] = await Promise.all([
    db.from("escalations").select("carrier_id, data").gte("updated_at", since).limit(10000),
    db.from("trucks").select("carrier_id"),
  ]);
  const truckCount = Math.max(1, trucks?.length ?? 0);
  const window = (days: number) => {
    const from = Date.now() - days * 86400_000;
    const list = (rows ?? []).map((r) => r.data as Escalation).filter((e) => Date.parse(e.createdAt) >= from);
    const toSupport = list.filter((e) => e.status === "with_support" || e.resolvedBy === "support");
    const byKind: Partial<Record<HandoffKind, number>> = {};
    for (const e of toSupport) byKind[handoffKind(e)] = (byKind[handoffKind(e)] ?? 0) + 1;
    const closed = toSupport.filter((e) => e.resolvedAt).map((e) => (Date.parse(e.resolvedAt!) - Date.parse(e.createdAt)) / 60000).sort((a, b) => a - b);
    const late = toSupport.filter((e) => ((e.resolvedAt ? Date.parse(e.resolvedAt) : Date.now()) - Date.parse(e.createdAt)) / 60000 > SLA_MINUTES(e)).length;
    return {
      repeats: repeats(list),
      handoffs: toSupport.length,
      toOwner: list.length - toSupport.length,
      perTruckPerWeek: Math.round((toSupport.length / truckCount / (days / 7)) * 100) / 100,
      byKind,
      medianMinutesToClose: closed.length ? Math.round(closed[Math.floor(closed.length / 2)]) : null,
      late,
    };
  };
  return Response.json({ trucks: truckCount, week: window(7), month: window(30), costs: await costs(trucks ?? []) });
}

/**
 * The weekly review: hand-offs (to support or owners) grouped by what they're about, most common first, with one
 * example each. Anything that keeps coming up is the next thing to teach the AI.
 */
function repeats(list: Escalation[]) {
  const shape = (reason: string) =>
    reason
      .replace(/\S+@\S+/g, "(email)")
      .replace(/\$[\d,.]+/g, "$")
      .replace(/\b[A-Z]{2,6}-\d{2,7}\b/g, "(load)")
      .replace(/\d+/g, "#")
      .split(/[.:;]/)[0]
      .split(/\s+/)
      .slice(0, 8)
      .join(" ");
  const groups = new Map<string, { pattern: string; count: number; toSupport: number; example: string; kind: HandoffKind }>();
  for (const e of list) {
    const key = shape(e.reason);
    const g = groups.get(key) ?? { pattern: key, count: 0, toSupport: 0, example: e.reason.slice(0, 240), kind: handoffKind(e) };
    g.count++;
    if (e.status === "with_support" || e.resolvedBy === "support") g.toSupport++;
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);
}

// What things cost, for the estimate: set these to Backroute's real rates. Defaults are rough list prices in dollars.
const price = (name: string, fallback: number) => Number(process.env[name] ?? "") || fallback;

/**
 * What each carrier cost to run this month, estimated: the AI's tokens (counted as they happen, lib/ai/usage), plus
 * texts, emails and call turns from the channel log. For pricing, and for spotting a carrier that costs far more than
 * it should (a runaway loop, a chatty broker).
 */
async function costs(trucks: { carrier_id: string }[]) {
  const db = admin();
  const month = new Date().toISOString().slice(0, 7);
  const start = `${month}-01T00:00:00Z`;
  const [{ data: usage }, { data: carriers }, { data: log }] = await Promise.all([
    db.from("usage").select("carrier_id, ai_calls, input_tokens, output_tokens").eq("month", month),
    db.from("carriers").select("id, name"),
    db.from("channel_messages").select("carrier_id, channel").eq("direction", "out").gte("created_at", start).limit(100000),
  ]);
  const inPer = price("COST_AI_INPUT_PER_MTOK", 5) / 1e6;
  const outPer = price("COST_AI_OUTPUT_PER_MTOK", 25) / 1e6;
  const per = { sms: price("COST_PER_TEXT", 0.0083), email: price("COST_PER_EMAIL", 0.0012), voice: price("COST_PER_CALL_TURN", 0.02) };
  const rows = new Map<string, { carrier: string; trucks: number; aiCalls: number; ai: number; texts: number; emails: number; callTurns: number; total: number }>();
  const row = (id: string) => {
    if (!rows.has(id)) rows.set(id, { carrier: carriers?.find((c) => c.id === id)?.name ?? (id === "unattributed" ? "Not tied to a carrier" : id), trucks: trucks.filter((t) => t.carrier_id === id).length, aiCalls: 0, ai: 0, texts: 0, emails: 0, callTurns: 0, total: 0 });
    return rows.get(id)!;
  };
  for (const u of usage ?? []) {
    const r = row(u.carrier_id as string);
    r.aiCalls += u.ai_calls as number;
    r.ai += (u.input_tokens as number) * inPer + (u.output_tokens as number) * outPer;
  }
  for (const m of log ?? []) {
    const r = row(m.carrier_id as string);
    if (m.channel === "sms") r.texts++;
    else if (m.channel === "email") r.emails++;
    else r.callTurns++;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, ai: Math.round(r.ai * 100) / 100, total: Math.round((r.ai + r.texts * per.sms + r.emails * per.email + r.callTurns * per.voice) * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}
