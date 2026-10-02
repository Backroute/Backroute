import "server-only";
import { canCall, canEmail, canText } from "../channels/out";
import { appointmentRounds } from "./appointments";
import { sendLayoverClaims } from "./layover";
import { claimRounds } from "./claims";
import { shareFacilityVisits } from "./network";
import { isBoard, runBoards } from "./boards";
import { followUpByPhone } from "./broker-call";
import { offerCapacity } from "./capacity";
import { trackHomeTime, weeklyCare } from "./care";
import { runCheckins } from "./checkins";
import { complianceReminders } from "./compliance";
import { pullStatements } from "./costs";
import { makeContractLoads } from "./contracts";
import { marksFor, type CarrierContext } from "./db";
import { forCarrier } from "./scope";
import { applyEld, checkCalls, lateNotices, readEld } from "./eld";
import { pullFeed, readFeed } from "./feeds";
import { integrationsFor, setStatus, type EldConfig, type FeedConfig } from "./integrations";
import { chasePayments } from "./money";
import { expireOffers, sendDetentionClaims, sendInvoices, warnCoiExpiring } from "./paperwork";
import { refreshPlans } from "./plan";
import { suggestRepositions } from "./reposition";
import { trackingRounds } from "./tracking";
import { portalReady, portalRounds } from "../portal/tasks";
import { morningBriefs } from "./brief";
import { reeferRounds } from "./reefer";
import { weeklyReview } from "./review";

/**
 * One carrier's share of the dispatcher's rounds: check-ins with drivers and following up when they go quiet,
 * invoices once the POD is in, detention claims, payment reminders, calling brokers who didn't answer, reading the
 * ELD and load feeds, telling brokers early when a truck will be late, and clearing old offers off the board.
 * `base` is the app's public address, for the calls Twilio places (null in sandbox, where nothing is dialed).
 */
export function runRounds(ctx: CarrierContext, now: number, base: string | null): Promise<string[]> {
  return forCarrier(ctx.carrier.id, () => rounds(ctx, now, base));
}

async function rounds(ctx: CarrierContext, now: number, base: string | null): Promise<string[]> {
  const id = ctx.carrier.id;
  const url = (path: string) => `${base ?? ""}${path}`;
  const done: string[] = [];
  if (canText(ctx.carrier)) {
    done.push(...(await runCheckins(ctx, await marksFor(id), now, (loadId, kind) => url(`/api/channels/voice/checkin?load=${encodeURIComponent(loadId)}&kind=${kind}`))));
    done.push(...(await followUpByPhone(ctx, now, (loadId) => url(`/api/channels/voice/broker?carrier=${encodeURIComponent(id)}&load=${encodeURIComponent(loadId)}`))));
  }
  if (canEmail(ctx.carrier)) {
    // Layover first: a stop held overnight is claimed as that, not as hours of detention, and it's on the invoice.
    done.push(...(await sendLayoverClaims(ctx, now)));
    done.push(...(await sendInvoices(ctx)));
    done.push(...(await sendDetentionClaims(ctx, now)));
    done.push(...(await chasePayments(ctx, now)));
    done.push(...(await claimRounds(ctx, now)));
  }
  // Connections, in order: the ELD first (where trucks are, drivers' hours), then load feeds and load boards,
  // which search from where the trucks now are.
  const links = await integrationsFor(id);
  for (const link of links.filter((l) => l.kind === "samsara" || l.kind === "motive")) {
    const kind = link.kind as "samsara" | "motive";
    try {
      const applied = await applyEld(ctx, kind, await readEld(kind, (link.config as EldConfig).apiKey));
      await setStatus(id, kind, `Connected · ${applied.trucks} trucks, ${applied.drivers} drivers updated`);
    } catch (e) {
      await setStatus(id, kind, `Not working: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  for (const link of links.filter((l) => l.kind === "load_feed")) {
    try {
      const cfg = link.config as FeedConfig;
      const added = await pullFeed(ctx, await readFeed(cfg), cfg.name ?? "Load feed");
      if (added) done.push(`${added} load${added === 1 ? "" : "s"} from ${cfg.name ?? "the load feed"}`);
      await setStatus(id, "load_feed", `Connected · last read ${new Date(now).toISOString().slice(11, 16)} UTC`);
    } catch (e) {
      await setStatus(id, "load_feed", `Not working: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  done.push(...(await runBoards(ctx, links.filter((l) => isBoard(l.kind)), now, (row, status) => setStatus(id, row.kind, status))));
  done.push(...(await offerCapacity(ctx, now)));
  done.push(...(await suggestRepositions(ctx, now)));
  done.push(...(await complianceReminders(ctx, now)));
  done.push(...(await pullStatements(ctx, links, now)));
  done.push(...(await makeContractLoads(ctx, now)));
  done.push(...(await trackHomeTime(ctx, now)));
  if (canText(ctx.carrier)) done.push(...(await trackingRounds(ctx, now)));
  if (canCall(ctx.carrier)) done.push(...(await appointmentRounds(ctx, now)));
  done.push(...(await weeklyCare(ctx, now)));
  // The driver's morning text, reefer readings, and the owner's Monday review.
  done.push(...(await morningBriefs(ctx, now).catch((e) => (console.error("[rounds] morning texts failed", e), []))));
  done.push(...(await reeferRounds(ctx, now).catch((e) => (console.error("[rounds] reefer checks failed", e), []))));
  done.push(...(await weeklyReview(ctx, now).catch((e) => (console.error("[rounds] weekly review failed", e), []))));
  await refreshPlans(ctx, now);
  if (canEmail(ctx.carrier)) {
    done.push(...(await lateNotices(ctx, now)));
    done.push(...(await checkCalls(ctx, now)));
  }
  const expired = await expireOffers(ctx, now);
  if (expired) done.push(`${expired} old offer${expired === 1 ? "" : "s"} taken off the board`);
  // What this carrier's trucks learned at docks goes into the shared record every carrier's AI reads.
  await shareFacilityVisits(ctx, now);
  // Jobs on broker websites the worker never picked up, and ones waiting on the owner too long.
  if (portalReady()) done.push(...(await portalRounds(ctx, now)));
  await warnCoiExpiring(ctx, now);
  return done;
}
