import type { LoadStage } from "./types";

/**
 * One way to show where anything stands, on every screen: done (green), moving (blue: the AI or the truck is on it),
 * waiting on someone (amber: a broker, a driver, an appointment), needs you (red), and set aside (gray).
 */
export type StatusKind = "done" | "moving" | "waiting" | "needs_you" | "off";

export const STATUS_CLASS: Record<StatusKind, string> = {
  done: "bg-live-soft text-[var(--accent-live)]",
  moving: "bg-info-soft text-[var(--accent-info)]",
  waiting: "bg-warn-soft text-[var(--accent-warn)]",
  needs_you: "bg-danger-soft text-[var(--accent-danger)]",
  off: "bg-ink-100 text-ink-600",
};

export const STAGE_STATUS: Record<LoadStage, StatusKind> = {
  sourced: "off",
  scoring: "off",
  offered: "waiting",
  negotiating: "waiting",
  rate_confirmed: "moving",
  booked: "moving",
  dispatched: "moving",
  at_pickup: "moving",
  in_transit: "moving",
  at_delivery: "moving",
  delivered: "done",
  declined: "off",
  cancelled: "needs_you",
};
