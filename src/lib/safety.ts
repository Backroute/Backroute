import type { SafetyEvent } from "./types";

/**
 * Driving events from the ELD, sorted into a few kinds an owner coaches on. Samsara and Motive each name them their own
 * way ("harshBrake", "hard_brake", "Harsh Braking"); the label is matched by its words, and anything else is "other"
 * with the ELD's own words kept.
 */
export function safetyKind(label: string): SafetyEvent["kind"] {
  const l = label.toLowerCase().replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  if (/speed/.test(l)) return "speeding";
  if (/brak/.test(l)) return "harsh_brake";
  if (/accel/.test(l)) return "harsh_accel";
  if (/turn|corner/.test(l)) return "harsh_turn";
  if (/follow|tailgat/.test(l)) return "following";
  if (/distract|phone|drows|inattent|eating|smok/.test(l)) return "distracted";
  if (/rolling stop|stop sign|run.*stop/.test(l)) return "rolling_stop";
  if (/crash|collision/.test(l)) return "collision";
  return "other";
}

export const SAFETY_LABEL: Record<SafetyEvent["kind"], string> = {
  speeding: "Speeding",
  harsh_brake: "Harsh braking",
  harsh_accel: "Harsh acceleration",
  harsh_turn: "Harsh turn",
  following: "Following too close",
  distracted: "Distracted driving",
  rolling_stop: "Rolling stop",
  collision: "Collision",
  other: "Other",
};

/** A short, plain coaching point per kind, for the owner's call or text. */
export const COACHING: Record<SafetyEvent["kind"], string> = {
  speeding: "Set cruise at the limit; a few minutes saved isn't worth a ticket or a CSA point.",
  harsh_brake: "Leave more room ahead so slowing down is gradual, especially loaded.",
  harsh_accel: "Ease off from stops; it saves fuel and the drivetrain.",
  harsh_turn: "Slow down before the turn, not in it; loaded trailers tip.",
  following: "Keep 7 seconds or more behind the vehicle ahead at highway speed.",
  distracted: "Phone down while rolling; use the app's hands-free mode.",
  rolling_stop: "Come to a full stop at stop signs; inspectors and cameras watch for it.",
  collision: "Call the driver first, make sure everyone's safe, then start the accident steps.",
  other: "Go over what happened with the driver.",
};

/** Merges newly read events into what a driver already has: no repeats, newest first, 60 days kept, coaching kept. */
export function mergeSafety(existing: SafetyEvent[] | undefined, incoming: SafetyEvent[], now: number): SafetyEvent[] {
  const byId = new Map((existing ?? []).map((e) => [e.id, e]));
  for (const e of incoming) if (!byId.has(e.id)) byId.set(e.id, e);
  const cutoff = now - 60 * 86400_000;
  return [...byId.values()].filter((e) => Date.parse(e.at) >= cutoff).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The last 30 days at a glance: how many, of what, and how many still to talk about. */
export function safetySummary(events: SafetyEvent[] | undefined, now: number) {
  const recent = (events ?? []).filter((e) => Date.parse(e.at) >= now - 30 * 86400_000);
  const byKind = new Map<SafetyEvent["kind"], number>();
  for (const e of recent) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  return { recent, uncoached: recent.filter((e) => !e.coached).length, byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]) };
}
