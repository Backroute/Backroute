import "server-only";
import { lookalikeOf } from "./fraud";
import type { Item } from "../cloud/rows";
import { lookupMc } from "../fmcsa-lookup";
import type { Broker } from "../types";
import { addActivity, claimMark, save, type CarrierContext } from "./db";
import { event, tellOwner } from "./dispatcher";
import { sendOrQueue } from "./outbox";

/**
 * Checking a broker the way a careful dispatcher does before the first load: their MC number against FMCSA (broker
 * authority active), the name on file against the name they use and their email domain, and a free email address
 * (a common sign of someone posing as a real broker). A broker who passes is booked with like any other; one who
 * doesn't isn't booked on its own, and the support team is asked to look.
 */

const FREE_MAIL = /@(gmail|yahoo|outlook|hotmail|icloud|aol|proton|protonmail|live|msn|mail|gmx|yandex)\./i;
const FILLER = new Set(["llc", "inc", "co", "corp", "corporation", "company", "ltd", "the", "and", "of", "group", "services", "service", "logistics", "freight", "transport", "transportation", "brokerage", "trucking", "solutions", "usa", "us"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const initials = (s: string) => words(s).filter((w) => !["llc", "inc", "co", "corp", "ltd", "the", "and", "of"].includes(w)).map((w) => w[0]).join("");

/** Whether the name a broker uses (or their email domain) belongs to the company FMCSA has on file. */
function sameCompany(onFile: string[], used: string, email?: string): boolean {
  const domain = email?.split("@")[1]?.split(".").slice(-2, -1)[0]?.toLowerCase();
  const usedKey = words(used).filter((w) => !FILLER.has(w) && w.length >= 3);
  return onFile.filter(Boolean).some((name) => {
    const key = words(name).filter((w) => !FILLER.has(w) && w.length >= 3);
    const joined = words(name).join("");
    if (usedKey.some((w) => key.includes(w))) return true;
    if (domain && !FREE_MAIL.test(email!) && (joined.includes(domain) || initials(name) === domain || key.some((w) => domain.includes(w)))) return true;
    return words(used).join("") === initials(name);
  });
}

/** Looks the broker up and records what was found. Returns the broker as it stands after. */
export async function checkBroker(ctx: CarrierContext, broker: Broker, mc?: string | null): Promise<Broker> {
  const fresh = broker.verifiedAt && Date.parse(broker.verifiedAt) > Date.now() - 30 * 86400_000;
  const number = (mc ?? broker.mc ?? "").replace(/\D/g, "");
  if (broker.authorityVerified && fresh && (!number || number === broker.mc)) return broker;
  if (!number) return broker;
  const r = await lookupMc(number);
  if (!r.ok) return { ...broker, mc: number };
  const rec = r.record;
  const at = new Date().toISOString();
  let next: Broker;
  if (!rec) next = { ...broker, mc: number, authorityVerified: false, fraudRisk: "high", verifiedAt: at, verifyNote: `FMCSA has no company with MC ${number}.` };
  else {
    const active = rec.brokerAuthority === "A";
    const nameOk = sameCompany([rec.legalName, rec.dbaName ?? ""], broker.company, broker.email);
    const freeMail = !!broker.email && FREE_MAIL.test(broker.email);
    // A real MC quoted from a domain that imitates a broker the carrier already works with: still an impostor.
    const imitated = broker.email ? lookalikeOf(broker.email, ctx.brokers.filter((b) => b.id !== broker.id)) : null;
    const verified = active && nameOk && !imitated;
    next = {
      ...broker,
      mc: number,
      legalName: rec.legalName,
      authorityVerified: verified,
      fraudRisk: !active || !nameOk || imitated ? "high" : freeMail ? "medium" : "low",
      verifiedAt: at,
      verifyNote: imitated
        ? `Quotes MC ${number} (${rec.legalName}) but writes from ${broker.email!.split("@")[1]}, which imitates ${imitated.company}'s ${imitated.email?.split("@")[1]}. Could be someone posing as them.`
        : !active
        ? `MC ${number} (${rec.legalName}) has no active broker authority with FMCSA.`
        : !nameOk
          ? `MC ${number} belongs to ${rec.legalName}, which doesn't match "${broker.company}"${broker.email ? ` <${broker.email}>` : ""}. Could be someone posing as them.`
          : `FMCSA: ${rec.legalName}, broker authority active${freeMail ? ". Writes from a free email address, so the AI double-checks the rate con" : ""}.`,
    };
  }
  await save("records", ctx.carrier.id, next as unknown as Item, "broker");
  ctx.brokers = ctx.brokers.map((b) => (b.id === next.id ? next : b));
  await addActivity(ctx.carrier.id, event({ type: "escalation", message: next.authorityVerified ? `Broker checked: ${next.company}` : `Broker didn't pass the check: ${next.company}`, detail: next.verifyNote, severity: next.authorityVerified ? "success" : "warning" }));
  return next;
}

/**
 * A broker the AI won't book with on its own. With no MC number yet, the AI emails them for it (their answer is
 * checked with FMCSA when it comes: lib/agent/email). One who failed the check isn't booked; the owner can mark them
 * trusted if they know them. Nobody on the support team has to look.
 */
export async function untrustedBroker(ctx: CarrierContext, broker: Broker, loadId?: string) {
  if (!(await claimMark(ctx.carrier.id, `broker:${broker.id}`, "verify_needed"))) return;
  if (!broker.mc && broker.email && !broker.fraudRisk?.startsWith("high")) {
    await sendOrQueue(ctx, {
      purpose: "ack",
      to: broker.email,
      toName: broker.contact || undefined,
      subject: `MC number for ${broker.company}`,
      body: `Hi${broker.contact ? ` ${broker.contact}` : ""},\n\nThanks for the loads. Before we book, what's your MC number? We check every broker with FMCSA first.\n\nThanks,\n${ctx.carrier.name}`,
      withinRules: true,
      why: `Ask ${broker.company} for their MC number?`,
    });
    await tellOwner(ctx, { reason: `${broker.company} sent loads but no MC number. The AI asked them for it and checks it with FMCSA before booking.`, loadId, source: "email", brokerId: broker.id });
    return;
  }
  await tellOwner(ctx, {
    reason: `The AI isn't booking with ${broker.company}${broker.email ? ` <${broker.email}>` : ""}: ${broker.verifyNote ?? "they didn't pass the broker check."} If you know them, mark them trusted on the broker and the AI will book with them.`,
    loadId,
    label: "Got it",
    source: "email",
    brokerId: broker.id,
    severity: "warning",
  });
}
