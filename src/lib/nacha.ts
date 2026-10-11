/**
 * Driver pay by direct deposit: a NACHA (ACH) file the owner uploads to their bank's business portal, one credit per
 * driver for the week's pay run. It's the standard 94-character layout: a file header, one PPD batch of credits
 * (service class 220), an entry per driver, the batch and file control records, and lines of 9s to fill the last block
 * of ten. Banks differ in small ways (what goes in "immediate origin", whether they want a balancing debit), so the
 * owner checks those two with their bank before the first upload; the numbers come from the pay runs, never typed.
 */

export interface NachaCompany {
  /** The company name as the bank has it, 16 characters on the statement. */
  name: string;
  /** The company ID the bank gave for ACH (often "1" plus the EIN). */
  companyId: string;
  /** The bank sending the money (the ODFI): its 9-digit routing number and name. */
  bankRouting: string;
  bankName: string;
  /** What the bank wants in "immediate origin" (10 characters); defaults to the company ID. */
  immediateOrigin?: string;
}

export interface NachaCredit {
  name: string;
  /** The driver's ID in the books, up to 15 characters. */
  id: string;
  routing: string;
  account: string;
  type: "checking" | "savings";
  /** Dollars. */
  amount: number;
}

/** A US bank routing number's own check: 3, 7, 1 weights across the nine digits add up to a multiple of ten. */
export function validRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 .,&'/-]/g, "");
const left = (s: string, n: number) => alnum(s).slice(0, n).padEnd(n, " ");
const leftRaw = (s: string, n: number) => s.slice(0, n).padEnd(n, " ");
const right = (s: string | number, n: number) => String(s).slice(-n).padStart(n, "0");
const yymmdd = (d: Date) => `${String(d.getUTCFullYear()).slice(2)}${right(d.getUTCMonth() + 1, 2)}${right(d.getUTCDate(), 2)}`;

/** Builds the file. Throws on a routing number that fails its check, so a typo never reaches the bank. */
export function nachaFile(company: NachaCompany, credits: NachaCredit[], opts: { effective: Date; now?: Date; description?: string }): string {
  const now = opts.now ?? new Date();
  if (!validRouting(company.bankRouting)) throw new Error("The company bank's routing number doesn't check out.");
  for (const c of credits) if (!validRouting(c.routing)) throw new Error(`${c.name}'s routing number doesn't check out.`);
  const paid = credits.filter((c) => Math.round(c.amount * 100) > 0);
  const odfi = company.bankRouting.slice(0, 8);
  const origin = (company.immediateOrigin ?? company.companyId).replace(/\s/g, "");
  const lines: string[] = [];

  lines.push(
    "1" + "01" + ` ${company.bankRouting}` + leftRaw(origin.padStart(10, " ").slice(-10), 10) + yymmdd(now) + right(now.getUTCHours(), 2) + right(now.getUTCMinutes(), 2) +
      "A" + "094" + "10" + "1" + left(company.bankName, 23) + left(company.name, 23) + left("", 8),
  );
  lines.push(
    "5" + "220" + left(company.name, 16) + left("", 20) + leftRaw(company.companyId, 10) + "PPD" + left(opts.description ?? "PAYROLL", 10) + left("", 6) + yymmdd(opts.effective) +
      "   " + "1" + odfi + right(1, 7),
  );
  let hash = 0;
  let total = 0;
  paid.forEach((c, i) => {
    const cents = Math.round(c.amount * 100);
    hash += Number(c.routing.slice(0, 8));
    total += cents;
    lines.push(
      "6" + (c.type === "savings" ? "32" : "22") + c.routing.slice(0, 8) + c.routing[8] + leftRaw(c.account.replace(/\s/g, ""), 17) + right(cents, 10) + left(c.id, 15) + left(c.name, 22) + "  " + "0" +
        odfi + right(i + 1, 7),
    );
  });
  const entryHash = right(hash % 10_000_000_000, 10);
  lines.push("8" + "220" + right(paid.length, 6) + entryHash + right(0, 12) + right(total, 12) + leftRaw(company.companyId, 10) + " ".repeat(19) + " ".repeat(6) + odfi + right(1, 7));
  const records = lines.length + 1;
  const blocks = Math.ceil(records / 10);
  lines.push("9" + right(1, 6) + right(blocks, 6) + right(paid.length, 8) + entryHash + right(0, 12) + right(total, 12) + " ".repeat(39));
  while (lines.length % 10) lines.push("9".repeat(94));
  for (const l of lines) if (l.length !== 94) throw new Error(`NACHA line is ${l.length} characters: ${l.slice(0, 1)}`);
  return lines.join("\n") + "\n";
}

/** "****6789" for showing an account number back. */
export const lastFour = (account: string) => `••••${account.replace(/\s/g, "").slice(-4)}`;
