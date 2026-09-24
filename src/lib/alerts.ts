import type { ActivityEvent } from "./types";

/** The only three things worth interrupting someone for. Everything else the AI does lives in its log. */
export type AlertKind = "needs_you" | "money" | "safety";

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
