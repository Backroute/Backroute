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
      handoffs: toSupport.length,
      toOwner: list.length - toSupport.length,
      perTruckPerWeek: Math.round((toSupport.length / truckCount / (days / 7)) * 100) / 100,
      byKind,
      medianMinutesToClose: closed.length ? Math.round(closed[Math.floor(closed.length / 2)]) : null,
      late,
    };
  };
  return Response.json({ trucks: truckCount, week: window(7), month: window(30) });
}
