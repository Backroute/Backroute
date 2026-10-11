// The integrations hub: the bank file for driver pay, ELD safety events, Xero invoices, the yearly driver-file
// reminders, and the catalog every panel is built from.
import { lastFour, nachaFile, validRouting } from "../../src/lib/nacha.ts";
import { mergeSafety, safetyKind, safetySummary } from "../../src/lib/safety.ts";
import { paperworkDue, yearAfter } from "../../src/lib/expiry.ts";
import { HUB, HUB_CATEGORIES, hubEntry } from "../../src/lib/integrations.ts";
import { xeroInvoice } from "../../src/lib/agent/xero.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

// ── Routing numbers: the 3-7-1 check digit. ──
ok("a routing number with a good check digit passes", validRouting("011000015") && validRouting("021000021"));
ok("one wrong digit fails", !validRouting("011000016") && !validRouting("02100002"));
ok("letters fail", !validRouting("01100001A"));
ok("only the last four are ever shown", lastFour("12 3456 7890") === "••••7890");

// ── The NACHA file. ──
const company = { name: "Lone Star Freight", companyId: "1234567890", bankRouting: "021000021", bankName: "Big Bank" };
const credits = [
  { name: "Marcus Webb", id: "drv-1", routing: "011000015", account: "123456789", type: "checking" as const, amount: 1843.27 },
  { name: "Ana Ruiz", id: "drv-2", routing: "021000021", account: "987654321", type: "savings" as const, amount: 1500 },
  { name: "Nobody", id: "drv-3", routing: "011000015", account: "1111", type: "checking" as const, amount: 0 },
];
const now = new Date("2026-10-12T15:04:00Z");
const file = nachaFile(company, credits, { effective: new Date("2026-10-13T12:00:00Z"), now });
const lines = file.trimEnd().split("\n");
ok("every record is 94 characters", lines.every((l) => l.length === 94), lines.map((l) => l.length));
ok("records fill whole blocks of ten", lines.length % 10 === 0, lines.length);
ok("file header, batch header, entries, batch control, file control, then 9s", lines[0][0] === "1" && lines[1][0] === "5" && lines[2][0] === "6" && lines[3][0] === "6" && lines[4][0] === "8" && lines[5][0] === "9" && lines.slice(6).every((l) => /^9{94}$/.test(l)));
ok("nothing to pay, no entry", lines.filter((l) => l[0] === "6").length === 2);
ok("the batch is credits only, PPD", lines[1].slice(1, 4) === "220" && lines[1].slice(50, 53) === "PPD");
ok("checking is 22, savings is 32", lines[2].slice(1, 3) === "22" && lines[3].slice(1, 3) === "32");
ok("amounts in cents", lines[2].slice(29, 39) === "0000184327" && lines[3].slice(29, 39) === "0000150000");
const total = 184327 + 150000;
ok("batch control totals the credits", lines[4].slice(32, 44) === String(total).padStart(12, "0") && lines[4].slice(20, 32) === "0".repeat(12));
ok("entry hash adds the receiving banks' first 8 digits", lines[4].slice(10, 20) === String(1100001 + 2100002).padStart(10, "0"));
ok("effective date is the day asked", lines[1].slice(69, 75) === "261013");
let threw = "";
try {
  nachaFile(company, [{ ...credits[0], routing: "011000016" }], { effective: now, now });
} catch (e) {
  threw = (e as Error).message;
}
ok("a bad routing number never reaches the bank", /Marcus Webb's routing number/.test(threw), threw);

// ── Safety events. ──
ok("Samsara and Motive words map to the same kinds", safetyKind("harshBrake") === "harsh_brake" && safetyKind("hard_brake") === "harsh_brake" && safetyKind("Speeding") === "speeding" && safetyKind("followingDistance") === "following" && safetyKind("mobileUsage") === "other" && safetyKind("Distracted Driving") === "distracted");
const t = Date.parse("2026-10-11T12:00:00Z");
const ev = (id: string, daysAgo: number, coached = false) => ({ id, at: new Date(t - daysAgo * 86400_000).toISOString(), kind: "speeding" as const, label: "Speeding", source: "samsara" as const, ...(coached ? { coached: { at: new Date(t).toISOString() } } : {}) });
const merged = mergeSafety([ev("a", 2, true), ev("old", 70)], [ev("a", 2), ev("b", 1)], t);
ok("merging keeps the coaching note, drops repeats and anything over 60 days, newest first", merged.map((e) => e.id).join() === "b,a" && !!merged[1].coached, merged.map((e) => e.id));
const sum = safetySummary([ev("a", 2, true), ev("b", 1), ev("c", 40)], t);
ok("summary counts the last 30 days and what's left to talk about", sum.recent.length === 2 && sum.uncoached === 1);

// ── Yearly driver-file checks. ──
ok("a year after a date", yearAfter("2025-10-20T00:00:00Z") === "2026-10-20" && yearAfter("2025-11-01") === "2026-11-01");
const items = paperworkDue({ trucks: [], drivers: [{ id: "d1", name: "Marcus", mvrAt: "2025-10-20", clearinghouseAt: "2025-12-30" } as never], now: t });
ok("the MVR review is due a year after the last one", items.some((i) => i.kind === "mvr" && i.due === "2026-10-20" && i.days === 9), items.map((i) => [i.kind, i.due, i.days]));
ok("a Clearinghouse query not due within 30 days isn't listed yet", !items.some((i) => i.kind === "clearinghouse"));

// ── Xero invoices. ──
const load = {
  id: "l1",
  referenceNumber: "BR-1001",
  stage: "delivered",
  lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN" },
  invoice: { number: "INV-1001", amount: 2450, draftedAt: "2026-10-01T10:00:00Z", sentAt: "2026-10-02T10:00:00Z", lines: [{ label: "Line haul", amount: 2300 }, { label: "Detention", amount: 150 }] },
  rateConReading: { paymentTerms: "Net 30" },
} as never;
const x = xeroInvoice(load, "Acme Logistics", "200");
ok("a sales invoice to the broker, one line per charge, on the sales account", x.Type === "ACCREC" && x.Contact.Name === "Acme Logistics" && x.LineItems.length === 2 && x.LineItems.every((l) => l.AccountCode === "200") && x.LineItems[1].UnitAmount === 150);
ok("dated when sent, due on the rate con's terms", x.Date === "2026-10-02" && x.DueDate === "2026-11-01", [x.Date, x.DueDate]);
ok("invoice number and load reference carried", x.InvoiceNumber === "INV-1001" && x.Reference === "BR-1001" && /BR-1001 · Dallas, TX to Memphis, TN/.test(x.LineItems[0].Description));

// ── The catalog. ──
const ids = HUB.map((e) => e.id);
ok("every entry has a unique id", new Set(ids).size === ids.length);
ok("every entry is in a listed category", HUB.every((e) => HUB_CATEGORIES.some((c) => c.name === e.category)));
ok("every category has at least one entry", HUB_CATEGORIES.every((c) => HUB.some((e) => e.category === c.name)));
ok("every entry says what it does, what Backroute does with it, and the steps", HUB.every((e) => e.does && e.gets.length && e.steps.length && e.how));
ok("the major ones are all there", ["samsara", "motive", "geotab", "dat", "truckstop", "wex", "comdata", "efs", "bestpass", "quickbooks", "xero", "rts", "otr", "triumph", "direct-deposit", "gmail", "outlook"].every((id) => !!hubEntry(id)));
ok("nothing claims a link it can't make: the rest go to support", hubEntry("123loadboard")?.flow.type === "request" && hubEntry("instant-pay")?.flow.type === "request");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
