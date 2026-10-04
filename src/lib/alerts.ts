import type { ActivityEvent } from "./types";

/** The only three things worth interrupting someone for. Everything else the AI does lives in its log. */
type AlertKind = "needs_you" | "money" | "safety";

export const ALERT_LABEL: Record<AlertKind, string> = { needs_you: "Needs you", money: "Money", safety: "Safety" };

export function alertKind(e: ActivityEvent): AlertKind | null {
  // Safety first: incidents, failed inspections, trucks that can't run.
  if (e.type === "incident" || (e.type === "dvir" && e.severity !== "success") || (e.type === "maintenance" && e.severity === "danger")) return "safety";
  // A person has to decide: approvals, loads to pick, time off, a driver's expense.
  if (e.type === "escalation" && e.severity === "warning") return "needs_you";
  if (e.type === "load_offered" || e.type === "time_off" || e.type === "expense") return "needs_you";
  // Money moving: a rate locked, a load delivered and invoiced, extra pay approved, a load lost.
  if (e.type === "rate_confirmed" || e.type === "call_completed" || e.type === "delivered" || e.type === "load_cancelled") return "money";
  if (e.severity === "success" && /\$\d/.test(e.message) && /detention|paid|funded|invoice|approved/i.test(e.message)) return "money";
  return null;
}

export function isAlert(e: ActivityEvent): boolean {
  return alertKind(e) !== null;
}

/** Alerts of one kind close together, shown as one line ("3 loads delivered") that opens to the list. */
interface AlertGroup {
  id: string;
  lead: ActivityEvent;
  items: ActivityEvent[];
  /** The one line for the group; the lead's own message when it's just one. */
  title: string;
}

const GROUP_WINDOW_MS = 6 * 3600_000;

const GROUP_TITLE: Partial<Record<ActivityEvent["type"], (n: number) => string>> = {
  delivered: (n) => `${n} loads delivered`,
  rate_confirmed: (n) => `${n} rates locked in`,
  booked: (n) => `${n} loads booked`,
  load_offered: (n) => `${n} new loads to pick from`,
  escalation: (n) => `${n} things need you`,
  call_completed: (n) => `${n} broker calls done`,
  time_off: (n) => `${n} time-off requests`,
  expense: (n) => `${n} driver expenses to check`,
  load_cancelled: (n) => `${n} loads cancelled`,
  incident: (n) => `${n} incidents reported`,
  dvir: (n) => `${n} inspection issues`,
  maintenance: (n) => `${n} maintenance alerts`,
};

/**
 * Groups newest-first alerts: same kind, same severity, within six hours of the newest in the group. Safety alerts
 * never fold into a group of other ones, and a group keeps the worst-looking one on top.
 */
export function groupAlerts(events: ActivityEvent[]): AlertGroup[] {
  const groups: AlertGroup[] = [];
  const open = new Map<string, AlertGroup>();
  for (const e of events) {
    const key = `${e.type}|${e.severity}`;
    const g = open.get(key);
    const titleFor = GROUP_TITLE[e.type];
    if (g && titleFor && Date.parse(g.lead.timestamp) - Date.parse(e.timestamp) <= GROUP_WINDOW_MS) {
      g.items.push(e);
      g.title = titleFor(g.items.length);
      continue;
    }
    const fresh: AlertGroup = { id: e.id, lead: e, items: [e], title: e.message };
    groups.push(fresh);
    open.set(key, fresh);
  }
  return groups;
}
