import "server-only";
import type { Item } from "../cloud/rows";
import { EXTRA_LABEL, extraAmount } from "../road-exceptions";
import { formatAtStop } from "../stop-time";
import type { Driver, ExtraClaim, ExtraKind, Load, LoadExceptionKind, MessageChannel } from "../types";
import { openClaim } from "./claims";
import { addActivity, claimMark, releaseMark, save, type CarrierContext } from "./db";
import { event, passToOwner, uid } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import { billTo } from "./paperwork";
import * as mail from "./templates";

/**
 * Work beyond the haul, and freight gone wrong, handled the way a dispatcher does it the same day:
 * - Extra pay: the driver says they tarped, unloaded by hand, went back for a redelivery, ran miles out of route,
 *   paid for a scale or reefer fuel. The claim goes to the broker in writing at the price on the rate con (or the
 *   owner's price, or the receipt), and onto the invoice once sent. With nothing to price it by, the owner is asked.
 * - Exceptions: a receiver refusing the load, freight that isn't what the paperwork says, a stolen load. The broker
 *   hears at once in writing and the driver is told exactly what to do; theft is an emergency.
 */

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

async function saveLoad(ctx: CarrierContext, next: Load) {
  await save("loads", ctx.carrier.id, next as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === next.id ? next : l));
}

/** The driver reported extra work on a load. Returns what to tell them. */
export async function claimExtra(ctx: CarrierContext, driver: Driver, load: Load, o: { kind: ExtraKind; detail: string; amount?: number; miles?: number }): Promise<string> {
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  // The same thing said twice in a day (a redelivery is the exception: there can be two).
  const today = new Date().toISOString().slice(0, 10);
  if (o.kind !== "redelivery" && (current.extraClaims ?? []).some((c) => c.kind === o.kind && c.at.slice(0, 10) === today))
    return `Already have ${EXTRA_LABEL[o.kind].toLowerCase()} on ${current.referenceNumber} today. Tell the driver it's being claimed.`;
  if ((o.kind === "scale" || o.kind === "reefer_fuel") && !o.amount) return "Ask the driver what the receipt says (the total), and to send a photo of it.";
  if (o.kind === "out_of_route" && !o.miles) return "Ask the driver how many miles out of route, and why (a closed road, a detour the broker or receiver asked for).";
  const claim: ExtraClaim = { id: uid("xtra"), kind: o.kind, detail: o.detail.slice(0, 300), at: new Date().toISOString(), ...(o.amount ? { amount: o.amount } : {}), ...(o.miles ? { miles: Math.round(o.miles) } : {}) };
  await saveLoad(ctx, { ...current, extraClaims: [...(current.extraClaims ?? []), claim], updatedAt: claim.at });
  await addActivity(ctx.carrier.id, event({ type: "check_call", loadId: current.id, message: `${driver.name.split(" ")[0]}: ${EXTRA_LABEL[o.kind].toLowerCase()} on ${current.referenceNumber}`, detail: claim.detail, severity: "info" }));
  const sent = await sendExtraClaims(ctx, Date.now(), current.id);
  return sent.length
    ? `Claimed it from the broker (${sent.join("; ")}). Tell the driver it's on the bill${o.kind === "scale" || o.kind === "reefer_fuel" ? ", and to keep the receipt and send a photo" : ""}.`
    : "Noted. The owner is asked what to charge for it; tell the driver it'll be billed.";
}

/** Extra-pay claims not sent yet: priced and sent to the broker, or the owner asked for the price once. */
export async function sendExtraClaims(ctx: CarrierContext, now: number, onlyLoad?: string): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    if (onlyLoad && load.id !== onlyLoad) continue;
    if (load.stage === "cancelled" || load.imported) continue;
    for (const c of load.extraClaims ?? []) {
      if (c.draftedAt) continue;
      const current = ctx.loads.find((l) => l.id === load.id) ?? load;
      const priced = extraAmount(c, current, ctx.settings.extraPay);
      if (!priced) {
        if (await claimMark(ctx.carrier.id, current.id, `extra_ask_${c.id}`))
          await passToOwner(ctx, {
            reason: `${current.referenceNumber}: the driver reported ${EXTRA_LABEL[c.kind].toLowerCase()} (${c.detail}), but the rate con doesn't say what it pays. Set your price in Settings → Business → Extra pay and Backroute claims it from the broker.`,
            loadId: current.id,
            label: "Set it",
            source: "sms",
            to: "owner",
          });
        continue;
      }
      const to = billTo(ctx, current);
      const mark = `extra_${c.id}`;
      if (!to || !(await claimMark(ctx.carrier.id, current.id, mark))) continue;
      try {
        const updated: ExtraClaim = { ...c, amount: priced.amount, basis: priced.basis, draftedAt: new Date(now).toISOString() };
        await saveLoad(ctx, { ...current, extraClaims: (current.extraClaims ?? []).map((x) => (x.id === c.id ? updated : x)), updatedAt: new Date(now).toISOString() });
        const broker = ctx.brokers.find((b) => b.id === current.brokerId);
        const how =
          priced.basis === "rate_con"
            ? "per the rate confirmation"
            : priced.basis === "receipt"
              ? "at cost; the receipt is attached to our invoice"
              : priced.basis === "per_mile"
                ? `at the load's rate (${c.miles} miles)`
                : "at our standard rate";
        const body = `Hi${broker?.contact ? ` ${broker.contact}` : ""},

On ${current.referenceNumber} (${current.lane.origin}, ${current.lane.originState} to ${current.lane.destination}, ${current.lane.destState}), our driver reported ${EXTRA_LABEL[c.kind].toLowerCase()}: ${c.detail}

That's ${money(priced.amount)} ${how}. Please add it to the rate confirmation so it's paid with the load.

Thanks,
${ctx.carrier.name}`;
        const result = await sendOrQueue(ctx, {
          purpose: "extra_pay",
          to,
          toName: broker?.contact || undefined,
          subject: mail.subjectFor(current, EXTRA_LABEL[c.kind].split(" (")[0]),
          body,
          loadId: current.id,
          amount: priced.amount,
          // The broker's own price, the owner's own price list, or a receipt: within the rules. Miles at the load's
          // rate a mile is the AI's arithmetic: the owner looks first.
          withinRules: priced.basis !== "per_mile",
          rule: "detention_default",
          why: `${current.referenceNumber}: claim ${money(priced.amount)} for ${EXTRA_LABEL[c.kind].toLowerCase()} (${c.detail})?`,
        });
        done.push(`${EXTRA_LABEL[c.kind].split(" (")[0].toLowerCase()} ${money(priced.amount)} ${result}`);
      } catch (error) {
        console.error("[extras] claim failed", load.id, error);
        await releaseMark(ctx.carrier.id, current.id, mark);
      }
    }
  }
  return done;
}

// ─── Freight gone wrong ──────────────────────────────────────────────────────

const DRIVER_STEPS: Record<LoadExceptionKind, string> = {
  refused:
    "Don't leave and don't drop the trailer. Get the receiver to write the refusal and the reason on the BOL and sign it, take photos of the freight and the BOL, and wait for the broker's instructions (return it, take it somewhere else, or salvage).",
  wrong_freight:
    "Don't sign for anything you didn't see loaded. Write what's actually on the trailer (count, product, seal number) on the BOL before signing, take photos, and wait for the broker to confirm before leaving.",
  theft:
    "If you're in danger, call 911 first. Then report it to the local police and get the report number. Don't touch the scene. Send the trailer number, seal number and the last place you saw it.",
};

const SUBJECT: Record<LoadExceptionKind, string> = { refused: "Refused at delivery", wrong_freight: "Freight doesn't match the paperwork", theft: "URGENT: cargo theft" };

function exceptionEmail(ctx: CarrierContext, load: Load, kind: LoadExceptionKind, details: string, at: string): string {
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const hi = `Hi${broker?.contact ? ` ${broker.contact}` : ""},`;
  const when = formatAtStop(at, kind === "wrong_freight" ? load.lane.originState : load.lane.destState);
  if (kind === "refused")
    return `${hi}

The receiver in ${load.lane.destination}, ${load.lane.destState} refused ${load.referenceNumber} at ${when}: ${details}

Our driver is holding on site with the freight and has the refusal written on the BOL. Please send instructions today: return to the shipper, deliver somewhere else, or salvage. Detention applies while the truck waits, and a return or redelivery is billed as extra miles.

Thanks,
${ctx.carrier.name}`;
  if (kind === "wrong_freight")
    return `${hi}

At pickup for ${load.referenceNumber} in ${load.lane.origin}, ${load.lane.originState}, what's being loaded doesn't match the load we booked: ${details}

Our driver is noting it on the BOL and holding before leaving. Please confirm with the shipper and tell us whether to take it as loaded (with the rate adjusted if the weight or product is different) or wait for the right freight.

Thanks,
${ctx.carrier.name}`;
  return `${hi}

Our load ${load.referenceNumber} (${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState}) was reported stolen at ${when}: ${details}

The driver is reporting it to the police and we'll send the report number as soon as we have it. Please notify the shipper. Our insurer is being told.

${ctx.carrier.name}`;
}

/** A refusal, the wrong freight, or a theft on the driver's load. Returns what to tell the driver. */
export async function loadException(ctx: CarrierContext, driver: Driver, load: Load, kind: LoadExceptionKind, details: string, source: MessageChannel): Promise<string> {
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  const at = new Date().toISOString();
  if (!(await claimMark(ctx.carrier.id, current.id, `exception_${kind}`))) return `Already on it: ${DRIVER_STEPS[kind]}`;
  let next: Load = { ...current, exception: { kind, at, details: details.slice(0, 500) }, updatedAt: at };
  await saveLoad(ctx, next);

  const to = billTo(ctx, current);
  let told = false;
  if (to) {
    const result = await sendOrQueue(ctx, {
      purpose: "notice",
      to,
      subject: mail.subjectFor(current, SUBJECT[kind]),
      body: exceptionEmail(ctx, current, kind, details, at),
      loadId: current.id,
      // Facts the broker has to hear the same hour: no price in it.
      withinRules: true,
      why: `Tell the broker about ${current.referenceNumber}: ${SUBJECT[kind].toLowerCase()}?`,
    });
    told = result === "sent";
    if (told) {
      next = { ...next, exception: { ...next.exception!, brokerToldAt: at } };
      await saveLoad(ctx, next);
    }
  }

  const first = driver.name.split(" ")[0];
  await addActivity(ctx.carrier.id, event({ type: "incident", loadId: current.id, message: `${first}: ${SUBJECT[kind].replace("URGENT: ", "").toLowerCase()} on ${current.referenceNumber}`, detail: details, severity: kind === "theft" ? "danger" : "warning" }));
  if (kind === "theft") {
    // An emergency: support's phones ring and the owner sees it; the claim file starts now, for the insurer.
    await passToOwner(ctx, { reason: `${current.referenceNumber} was reported stolen by ${driver.name}: ${details}. Call the driver, make sure they're safe and the police have it, and call your cargo insurer.`, loadId: current.id, critical: true, label: "Handled", source, to: "support" });
    await openClaim(ctx, next, { source: "driver", kind: "loss", details: `Stolen: ${details}` });
  } else {
    await passToOwner(ctx, {
      reason: `${current.referenceNumber}: ${kind === "refused" ? "the receiver refused the load" : "the freight at pickup doesn't match the paperwork"}. ${details}. ${to ? (told ? "The broker has it in writing and" : "The note to the broker is waiting for your OK;") : "There's no broker email on the load, so call them;"} the driver is holding for instructions.`,
      loadId: current.id,
      label: "Sorted",
      source,
      to: "owner",
    });
  }
  return `${told ? "The broker has been told in writing. " : ""}Tell ${first}: ${DRIVER_STEPS[kind]}`;
}
