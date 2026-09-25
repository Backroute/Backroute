import type { OwnerRule } from "./types";

/** The judgment calls an owner can hand to the AI, in the words the Settings page and the AI's suggestion use. */
export const OWNER_RULES: { rule: OwnerRule; label: string; detail: string; kind: string }[] = [
  { rule: "tonu_default", kind: "TONU claims", label: "Claim TONU at the usual amount", detail: "When a broker cancels after the truck is rolling and the rate con doesn't say what TONU pays." },
  { rule: "detention_default", kind: "detention claims", label: "Claim detention at the usual rate", detail: "When the truck waited past the free time and the rate con doesn't give a detention rate." },
  { rule: "invoice_noted_pod", kind: "invoices with a noted POD", label: "Send invoices even when the POD has a note", detail: "A shortage or damage written on the POD. The note goes with the invoice either way." },
  { rule: "replies", kind: "email replies", label: "Let the AI send its own email replies", detail: "On Within my rules. It still never names a price that isn't already in the conversation." },
];

export const ruleInfo = (rule: OwnerRule) => OWNER_RULES.find((r) => r.rule === rule)!;
