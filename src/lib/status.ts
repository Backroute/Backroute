import type { LoadStage } from "./types";

/**
 * One way to show where anything stands, on every screen: a grey pill with a small mark (components/ui/mark). The mark
 * carries the meaning: green dot done, black dot moving (Backroute or the truck is on it), orange ring waiting, red
 * circle with a "!" needs you, light grey dot set aside. The pill itself is never coloured, so a screen full of
 * statuses stays calm.
 */
export type StatusKind = "done" | "moving" | "waiting" | "needs_you" | "off";

export const STATUS_PILL = "bg-ink-100 text-ink-800";

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
