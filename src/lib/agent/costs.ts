import "server-only";
import { admin, claimMark, type CarrierContext } from "./db";
import { setStatus, type IntegrationRow, type StatementConfig } from "./integrations";
import { matchToLoads, readFuelCsv, readTollCsv } from "../fuel-import";
import { rowFor, type Item } from "../cloud/rows";
import { fetchOwnerUrl, UnsafeUrl } from "../owner-url";

/**
 * Fuel card and toll statements by themselves: the carrier gives the address where the card company (or their toll
 * account) publishes the transactions as CSV, a scheduled report's link or an SFTP-to-web drop, with the header it
 * needs. The AI reads it once a day, puts each line on its load, and saves only lines it hasn't seen.
 */

export class StatementError extends Error {}

const MAX_BYTES = 5_000_000;

export async function readStatement(cfg: StatementConfig): Promise<string> {
  let res: Response;
  try {
    res = await fetchOwnerUrl(cfg.url, { headers: cfg.headerName && cfg.headerValue ? { [cfg.headerName]: cfg.headerValue } : {}, signal: AbortSignal.timeout(20000), cache: "no-store" });
  } catch (e) {
    throw new StatementError(e instanceof UnsafeUrl ? e.message : "Couldn't reach the statement address.");
  }
  if (!res.ok) throw new StatementError(`The statement address answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new StatementError("That statement is too big to read at once; ask for a daily file.");
  return text;
}

/** Reads a statement and saves its new lines; returns how many were new and how many landed on a load. */
export async function importStatementText(ctx: CarrierContext, kind: "fuel" | "toll", text: string): Promise<{ read: number; matched: number }> {
  const read = kind === "fuel" ? readFuelCsv(text, ctx.carrier.id, ctx.trucks) : readTollCsv(text, ctx.carrier.id, ctx.trucks);
  const rows = matchToLoads<(typeof read.rows)[number]>(read.rows, ctx.loads);
  if (!rows.length) return { read: 0, matched: 0 };
  const db = admin();
  for (let n = 0; n < rows.length; n += 200) {
    const chunk = rows.slice(n, n + 200).map((r) => rowFor("records", kind, ctx.carrier.id, r as unknown as Item));
    // The same line from an overlapping statement keeps its id: it's skipped, not counted twice.
    const { error } = await db.from("records").upsert(chunk, { onConflict: "carrier_id,kind,id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { read: rows.length, matched: rows.filter((r) => r.loadId).length };
}

/** Once a day per connected statement. */
export async function pullStatements(ctx: CarrierContext, links: IntegrationRow[], now: number): Promise<string[]> {
  const done: string[] = [];
  const day = new Date(now).toISOString().slice(0, 10);
  for (const link of links.filter((l) => l.kind === "fuel_feed" || l.kind === "toll_feed")) {
    const kind = link.kind === "fuel_feed" ? "fuel" : "toll";
    if (!(await claimMark(ctx.carrier.id, "statements", `${link.kind}:${day}`))) continue;
    try {
      const r = await importStatementText(ctx, kind, await readStatement(link.config as StatementConfig));
      await setStatus(ctx.carrier.id, link.kind, `Connected · ${day}: ${r.read} line${r.read === 1 ? "" : "s"}, ${r.matched} on a load`);
      if (r.read) done.push(`${r.read} ${kind} line${r.read === 1 ? "" : "s"} imported`);
    } catch (e) {
      await setStatus(ctx.carrier.id, link.kind, `Not working: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return done;
}
