import type { OwnerRule } from "./types";

/** The judgment calls an owner can hand to the AI, in the words the Settings page and the AI's suggestion use. */
export const OWNER_RULES: { rule: OwnerRule; label: string; detail: string; kind: string }[] = [
  { rule: "tonu_default", kind: "TONU claims", label: "Claim TONU at the usual amount", detail: "When a broker cancels after the truck is rolling and the rate con doesn't say what TONU pays." },
  { rule: "detention_default", kind: "detention claims", label: "Claim detention at the usual rate", detail: "When the truck waited past the free time and the rate con doesn't give a detention rate." },
  { rule: "invoice_noted_pod", kind: "invoices with a noted POD", label: "Send invoices even when the POD has a note", detail: "A shortage or damage written on the POD. The note goes with the invoice either way." },
  { rule: "replies", kind: "email replies", label: "Let Backroute send its own email replies", detail: "On Within my rules. It still never names a price that isn't already in the conversation." },
  { rule: "reposition", kind: "moves of empty trucks to busier freight", label: "Move empty trucks to busier freight", detail: "When a truck sits empty half a day where nothing ships, Backroute sends it toward the nearest place with freight, within half your empty-miles limit." },
  { rule: "portal_setup", kind: "carrier setups on broker websites", label: "Submit carrier setups on broker websites", detail: "MyCarrierPackets, RMIS, Highway and the like, filled from your details and papers. Off: you see each one before it's submitted." },
];

export const ruleInfo = (rule: OwnerRule) => OWNER_RULES.find((r) => r.rule === rule)!;
