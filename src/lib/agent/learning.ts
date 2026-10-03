import "server-only";
import type { Item } from "../cloud/rows";
import { ruleInfo } from "../rules";
import type { Escalation, OwnerRule } from "../types";
import { claimMark, save, type CarrierContext } from "./db";
import { passToOwner } from "./dispatcher";

/** How many in a row, sent as the AI wrote them, before it offers to stop asking. */
const STREAK = 3;

/**
 * The owner just sent one of the AI's emails. If they've sent the last few of this kind exactly as written, the AI
 * offers (once) to stop asking about them. Nothing changes unless the owner says yes.
 */
export async function noticeApprovals(ctx: CarrierContext, approved: Escalation) {
  const rule = approved.draft?.rule;
  if (!rule || ctx.settings.ownerRules?.[rule]) return;
  const same = [approved, ...ctx.escalations.filter((e) => e.id !== approved.id)]
    .filter((e) => e.draft?.rule === rule && e.status === "resolved" && e.resolvedBy === "carrier")
    .sort((a, b) => Date.parse(b.resolvedAt ?? "") - Date.parse(a.resolvedAt ?? ""))
    .slice(0, STREAK);
  if (same.length < STREAK || same.some((e) => !e.draft?.sentAt || e.draft.edited)) return;
  if (!(await claimMark(ctx.carrier.id, "rules", `suggest:${rule}`))) return;
  const info = ruleInfo(rule);
  const e = await passToOwner(ctx, {
    reason: `You've sent the last ${STREAK} ${info.kind} the AI wrote without changing a word. Want it to send these on its own from now on? You can turn it off in Settings any time.`,
    label: "Not now",
    source: "app",
    to: "owner",
  });
  await save("escalations", ctx.carrier.id, { ...e, suggestRule: rule } as unknown as Item);
}

/**
 * The owner just answered one of the AI's yes/no questions (move an empty truck to busier freight). If the last few of
 * that kind were all yes, the AI offers (once) to make those calls itself. Nothing changes unless the owner says yes.
 */
export async function noticeDecisions(ctx: CarrierContext, answered: Escalation) {
  const kind = answered.decision?.kind;
  const rule: OwnerRule | null = kind === "reposition" ? "reposition" : null;
  if (!rule || !answered.approved || ctx.settings.ownerRules?.[rule]) return;
  const same = ctx.escalations
    .filter((e) => e.decision?.kind === kind && e.status === "resolved" && e.resolvedBy === "carrier" && e.approved !== undefined)
    .sort((a, b) => Date.parse(b.resolvedAt ?? "") - Date.parse(a.resolvedAt ?? ""))
    .slice(0, STREAK);
  if (same.length < STREAK || same.some((e) => !e.approved)) return;
  if (!(await claimMark(ctx.carrier.id, "rules", `suggest:${rule}`))) return;
  const info = ruleInfo(rule);
  const e = await passToOwner(ctx, {
    reason: `You've said yes the last ${STREAK} times the AI asked about ${info.kind}. Want it to make these calls on its own from now on? You can turn it off in Settings any time.`,
    label: "Not now",
    source: "app",
    to: "owner",
  });
  await save("escalations", ctx.carrier.id, { ...e, suggestRule: rule } as unknown as Item);
}
