import "server-only";
import { open, seal } from "../portal/vault";
import { lastFour, nachaFile, validRouting, type NachaCompany, type NachaCredit } from "../nacha";
import type { PayRun } from "../types";
import { admin } from "./db";
import { integrationsFor, saveIntegration } from "./integrations";

/**
 * Driver direct deposit: the company's sending bank (no secrets: routing, name, ACH company ID) and each driver's
 * account, the account number sealed with the vault key like every other secret. The week's NACHA file is built from
 * the pay runs on demand; Backroute never moves the money itself, the owner uploads the file to their bank.
 */
export interface PayoutsConfig {
  company?: NachaCompany;
  drivers: Record<string, { routing: string; account: string; type: "checking" | "savings"; last4: string; at: string }>;
}

const bind = (carrierId: string, driverId: string) => `${carrierId}|payouts|${driverId}`;

export async function payoutsFor(carrierId: string): Promise<PayoutsConfig> {
  const row = (await integrationsFor(carrierId)).find((r) => r.kind === "payouts");
  return (row?.config as unknown as PayoutsConfig) ?? { drivers: {} };
}

async function store(carrierId: string, config: PayoutsConfig) {
  const n = Object.keys(config.drivers).length;
  await saveIntegration(carrierId, "payouts", config as never, `${config.company ? `Bank: ${config.company.bankName}` : "No sending bank yet"} · ${n} driver account${n === 1 ? "" : "s"}`);
}

export async function saveCompany(carrierId: string, company: NachaCompany): Promise<string | null> {
  if (!validRouting(company.bankRouting)) return "That routing number doesn't check out. It's the 9 digits on the bottom left of a check.";
  const config = await payoutsFor(carrierId);
  await store(carrierId, { ...config, company });
  return null;
}

export async function saveDriverBank(carrierId: string, driverId: string, input: { routing: string; account: string; type: "checking" | "savings" }): Promise<string | null> {
  if (!validRouting(input.routing)) return "That routing number doesn't check out.";
  if (!/^\d{4,17}$/.test(input.account.replace(/\s/g, ""))) return "Account numbers are 4 to 17 digits.";
  const config = await payoutsFor(carrierId);
  const account = input.account.replace(/\s/g, "");
  config.drivers[driverId] = { routing: input.routing, account: seal(account, bind(carrierId, driverId)), type: input.type, last4: lastFour(account), at: new Date().toISOString() };
  await store(carrierId, config);
  return null;
}

export async function removeDriverBank(carrierId: string, driverId: string) {
  const config = await payoutsFor(carrierId);
  delete config.drivers[driverId];
  await store(carrierId, config);
}

/** The bank file for one week's pay runs, and who was left out (no account on file, or nothing to pay). */
export async function weekFile(carrierId: string, period: string, effective: Date): Promise<{ file: string; total: number; paid: string[]; skipped: string[] }> {
  const config = await payoutsFor(carrierId);
  if (!config.company) throw new Error("Add the bank the pay comes from first.");
  const { data } = await admin().from("records").select("data").eq("carrier_id", carrierId).eq("kind", "pay_run");
  const runs = (data ?? []).map((r) => r.data as PayRun).filter((r) => r.period === period && r.net > 0);
  const { data: drivers } = await admin().from("drivers").select("id, data").eq("carrier_id", carrierId);
  const nameOf = (id: string) => ((drivers ?? []).find((d) => d.id === id)?.data as { name?: string } | undefined)?.name ?? "Driver";
  const credits: NachaCredit[] = [];
  const skipped: string[] = [];
  for (const run of runs) {
    const bank = config.drivers[run.driverId];
    const account = bank ? open(bank.account, bind(carrierId, run.driverId))?.value : undefined;
    if (!bank || !account) {
      skipped.push(nameOf(run.driverId));
      continue;
    }
    credits.push({ name: nameOf(run.driverId), id: run.driverId.slice(0, 15), routing: bank.routing, account, type: bank.type, amount: run.net });
  }
  if (!credits.length) throw new Error(runs.length ? "None of this week's drivers have a bank account on file." : "No pay runs with pay in them for that week.");
  return { file: nachaFile(config.company, credits, { effective }), total: credits.reduce((s, c) => s + c.amount, 0), paid: credits.map((c) => c.name), skipped };
}
