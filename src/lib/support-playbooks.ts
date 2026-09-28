import type { Escalation } from "./types";

/**
 * What kind of hand-off an item is, worked out from what the AI wrote, and the playbook support follows for each.
 * Also how long each kind may wait before it's late: urgent ones 15 minutes, the rest 2 hours.
 */

export type HandoffKind = "emergency" | "fraud" | "broker" | "money" | "driver" | "breakdown" | "portal" | "system" | "paperwork" | "other";

const RULES: [HandoffKind, RegExp][] = [
  ["emergency", /\b(crash|accident|injur|911|hurt|fire)\b/i],
  ["fraud", /double brokering|bank or payment details|posing as|impostor|imitates/i],
  ["breakdown", /\bbroke down|breakdown|repair shop|tow\b/i],
  ["portal", /online portal|onboarding portal|set up through|docusign|their website/i],
  ["system", /couldn't answer \(twice\)|couldn't write a reply|service was down|couldn't be delivered/i],
  ["broker", /check broker|broker .*(didn't pass|authority)|onboarding portal|set up through/i],
  ["money", /invoice|paid|payment|detention|tonu|rate|\$\d/i],
  ["driver", /hasn't answered|isn't happy|driver|home in \d+ days/i],
  ["paperwork", /rate con|pod|papers|w-9|insurance certificate|setup/i],
];

export function handoffKind(e: Pick<Escalation, "reason" | "complexity">): HandoffKind {
  for (const [kind, re] of RULES) if (re.test(e.reason)) return kind;
  return e.complexity === "critical" ? "emergency" : "other";
}

export const SLA_MINUTES = (e: Pick<Escalation, "complexity">) => (e.complexity === "critical" ? 15 : 120);

export const PLAYBOOK: Record<HandoffKind, { label: string; steps: string[] }> = {
  emergency: { label: "Emergency", steps: ["Call the driver now. If no answer in 2 tries, call 911 with the last GPS position.", "Call the owner.", "Tell the broker the load is delayed; no details about injuries.", "Write down times and who you spoke to."] },
  fraud: { label: "Possible fraud", steps: ["Don't reply to the email or use any number or link in it.", "Call the broker on the number FMCSA has for their MC.", "If it's not them: tell the owner, mark the broker as not trusted, and keep the truck off the load."] },
  breakdown: { label: "Breakdown", steps: ["Check the driver is safe and off the road.", "Confirm the shop the AI found can come, and what it'll cost roughly.", "Get the owner's OK on the bill.", "Give the broker a new ETA."] },
  broker: { label: "Broker check", steps: ["Look up the MC on FMCSA and call the number listed there.", "Check the email domain matches the broker's real one.", "If they check out, mark them trusted; if not, tell the owner why."] },
  money: { label: "Money", steps: ["Open the load and the thread.", "Call the broker's accounts payable or dispatch with the invoice or claim number.", "Write down what they promised and when."] },
  driver: { label: "Driver", steps: ["Text first, then call.", "If they're unhappy, listen and pass it to the owner the same day.", "Nothing about pay or time off without the owner."] },
  portal: { label: "Another company's website", steps: ["Open the link from the broker's email.", "Sign or fill it in with the carrier's details and papers from Settings.", "Close it with a note of what you submitted."] },
  system: { label: "Our systems", steps: ["Answer the person the AI couldn't: text, call or email from the console.", "Check the status page for the AI, text or email service.", "Tell engineering if it keeps happening."] },
  paperwork: { label: "Paperwork", steps: ["Open the document and the load.", "Fix what's wrong, or ask the broker for a corrected copy.", "Close it with a note of what you did."] },
  other: { label: "Other", steps: ["Read the thread.", "Do what's needed, or hand it to the owner if it's their decision.", "Close it with a note."] },
};
