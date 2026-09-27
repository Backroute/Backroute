import "server-only";
import { canEmail, canText } from "../channels/out";
import { isBoard, runBoards } from "./boards";
import { followUpByPhone } from "./broker-call";
import { offerCapacity } from "./capacity";
import { trackHomeTime, weeklyCare } from "./care";
import { runCheckins } from "./checkins";
import { complianceReminders } from "./compliance";
import { marksFor, type CarrierContext } from "./db";
import { applyEld, checkCalls, lateNotices, readEld } from "./eld";
import { pullFeed, readFeed } from "./feeds";
import { integrationsFor, setStatus, type EldConfig, type FeedConfig } from "./integrations";
import { chasePayments } from "./money";
import { expireOffers, sendDetentionClaims, sendInvoices, warnCoiExpiring } from "./paperwork";
import { refreshPlans } from "./plan";
import { suggestRepositions } from "./reposition";

/**
 * One carrier's share of the dispatcher's rounds: check-ins with drivers and following up when they go quiet,
 * invoices once the POD is in, detention claims, payment reminders, calling brokers who didn't answer, reading the
 * ELD and load feeds, telling brokers early when a truck will be late, and clearing old offers off the board.
 * `base` is the app's public address, for the calls Twilio places (null in sandbox, where nothing is dialed).
 */
export async function runRounds(ctx: CarrierContext, now: number, base: string | null): Promise<string[]> {
  const id = ctx.carrier.id;
  const url = (path: string) => `${base ?? ""}${path}`;
  const done: string[] = [];
  if (canText(ctx.carrier)) {
    done.push(...(await runCheckins(ctx, await marksFor(id), now, (loadId, kind) => url(`/api/channels/voice/checkin?load=${encodeURIComponent(loadId)}&kind=${kind}`))));
    done.push(...(await followUpByPhone(ctx, now, (loadId) => url(`/api/channels/voice/broker?carrier=${encodeURIComponent(id)}&load=${encodeURIComponent(loadId)}`))));
  }
  if (canEmail(ctx.carrier)) {
    done.push(...(await sendInvoices(ctx)));
    done.push(...(await sendDetentionClaims(ctx, now)));
    done.push(...(await chasePayments(ctx, now)));
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
  done.push(...(await trackHomeTime(ctx, now)));
  done.push(...(await weeklyCare(ctx, now)));
  await refreshPlans(ctx, now);
  if (canEmail(ctx.carrier)) {
    done.push(...(await lateNotices(ctx, now)));
    done.push(...(await checkCalls(ctx, now)));
  }
  const expired = await expireOffers(ctx, now);
  if (expired) done.push(`${expired} old offer${expired === 1 ? "" : "s"} taken off the board`);
  await warnCoiExpiring(ctx, now);
  return done;
}
