import { paperworkDue, stageFor, cantRun } from "../../src/lib/expiry.ts";
import { readFuelCsv, readTollCsv, matchToLoads, onlyNew, gallonsByState, toDay } from "../../src/lib/fuel-import.ts";
import { buildPayRun, form1099s, weekOf, weekEnd, payRunsCsv } from "../../src/lib/pay-runs.ts";
import { contractLoadsDue, upcomingPickups } from "../../src/lib/contracts.ts";
import { laneHistory } from "../../src/lib/lane-history.ts";
import { faultSeverity } from "../../src/lib/maintenance.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label); } };
const DAY = 86400_000;
const now = Date.parse("2026-10-02T15:00:00Z");
const day = (n: number) => new Date(now + n * DAY).toISOString().slice(0, 10);

// Expiry
ok("stages 30/14/7/0", stageFor(25) === 30 && stageFor(14) === 14 && stageFor(6) === 7 && stageFor(0) === 0 && stageFor(-3) === 0 && stageFor(40) === null);
const truck = { id: "t1", unitNumber: "T-104", registrationExpires: day(9), nextInspectionDue: day(200), faults: [] } as any;
const drv = { id: "d1", name: "Marcus Bell", cdlExpires: day(400), medCardExpires: day(-1) } as any;
const due = paperworkDue({ trucks: [truck], drivers: [drv], insuranceExpires: day(20), now });
ok("registration due in 9 days is at the 14-day reminder", due.find((d) => d.kind === "registration")?.stage === 14);
ok("lapsed med card is stage 0 and listed first", due[0].kind === "med_card" && due[0].stage === 0 && due[0].days < 0);
ok("insurance at the 30-day stage", due.find((d) => d.kind === "insurance")?.stage === 30);
ok("CDL far off isn't listed", !due.some((d) => d.kind === "cdl"));
ok("IFTA Q3 return due Oct 31 listed", due.some((d) => d.kind === "ifta_return" && d.due === "2026-10-31"));
ok("can't run with a lapsed med card", /medical card/.test(cantRun(truck, drv, now) ?? ""));
ok("can't run with a critical fault", /engine fault/.test(cantRun({ ...truck, faults: [{ severity: "critical" }] }, { ...drv, medCardExpires: day(100) }, now) ?? ""));
ok("fine otherwise", cantRun(truck, { ...drv, medCardExpires: day(100) }, now) === null);

// Fuel import
const trucks = [{ id: "t1", unitNumber: "T-104" }, { id: "t2", unitNumber: "T-105" }] as any;
const csv = `Transaction Date,Unit,Truck Stop,City,State,Gallons,Total Amount,Product
09/30/2026,T-104,"Pilot #123, Exit 4",Joplin,MO,120.5,"$470.15",ULSD
10/01/2026,0105,Love's,Tulsa,OK,98,381.22,Diesel
10/01/2026,T-104,Love's,Tulsa,OK,8,31.90,DEF
,T-104,Bad line,,,,,
10/01/2026,9999,Somewhere,Austin,TX,50,190,Diesel`;
const f = readFuelCsv(csv, "c1", trucks, "2026-10-02T00:00:00Z");
ok("reads 4 lines, skips the one with no date", f.rows.length === 4 && f.skipped.length === 1);
ok("quoted merchant with a comma, $ amounts", f.rows[0].merchant === "Pilot #123, Exit 4" && f.rows[0].amount === 470.15 && f.rows[0].gallons === 120.5);
ok("unit by number and by card digits", f.rows[0].truckId === "t1" && f.rows[1].truckId === "t2" && f.rows[3].truckId === null);
ok("DEF recognized", f.rows[2].product === "def" && f.rows[0].product === "diesel");
const loads = [
  { id: "L1", truckId: "t1", stage: "delivered", createdAt: "2026-09-29T10:00:00Z", pickupAt: "2026-09-30T14:00:00Z", deliveryAt: "2026-10-01T18:00:00Z", updatedAt: "2026-10-01T19:00:00Z" },
  { id: "L2", truckId: "t2", stage: "in_transit", createdAt: "2026-09-30T10:00:00Z", pickupAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T09:00:00Z" },
  { id: "L3", truckId: "t1", stage: "offered", createdAt: "2026-09-30T10:00:00Z", updatedAt: "2026-09-30T10:00:00Z" },
] as any;
const matched = matchToLoads(f.rows, loads);
ok("each line on the load its truck ran that day", matched[0].loadId === "L1" && matched[1].loadId === "L2" && matched[2].loadId === "L1" && matched[3].loadId === null);
ok("same statement twice adds nothing", onlyNew(matched, readFuelCsv(csv, "c1", trucks).rows).length === 0);
ok("gallons by state, diesel only (a line with no truck still counts for IFTA)", JSON.stringify(gallonsByState(matched, "2026-07-01", "2026-12-31").map((s) => s.state)) === '["MO","OK","TX"]');
ok("date formats", toDay("2026-9-4") === "2026-09-04" && toDay("9/4/26") === "2026-09-04" && toDay("14-Sep-2026") === "2026-09-14");
const t = readTollCsv("Exit Date,Transponder,Agency,Exit Plaza,Toll Amount\n2026-10-01 08:12,T-105,Turner Turnpike,Stroud,($12.50)", "c1", trucks);
ok("toll with plate/transponder and a refund in parentheses", t.rows[0].truckId === "t2" && t.rows[0].amount === -12.5 && t.rows[0].state === "");

// Pay runs
const driver = { id: "d1", name: "Marcus Bell", carrierId: "c1", payType: "percentage", payRate: 0.25, deductions: [{ id: "x", label: "Insurance", amount: 45, every: "run" }, { id: "y", label: "Uniform", amount: 30, every: "once" }], escrow: { perRun: 100, cap: 150, held: 100 } } as any;
const ptrucks = [{ id: "t1", driverId: "d1" }, { id: "t9", driverId: "d2", secondDriverId: "d1" }] as any;
const pl = [
  { id: "A", referenceNumber: "A1", truckId: "t1", stage: "delivered", bookedRate: 2000, targetRate: 2000, lane: { origin: "X", originState: "TX", destination: "Y", destState: "OK", miles: 400 }, deadheadMiles: 0, updatedAt: "2026-09-29T12:00:00Z" },
  { id: "B", referenceNumber: "B1", truckId: "t9", stage: "delivered", bookedRate: 4000, targetRate: 4000, lane: { origin: "X", originState: "TX", destination: "Y", destState: "OK", miles: 900 }, deadheadMiles: 0, updatedAt: "2026-10-01T12:00:00Z" },
  { id: "C", referenceNumber: "C1", truckId: "t1", stage: "delivered", bookedRate: 1000, targetRate: 1000, lane: { origin: "X", originState: "TX", destination: "Y", destState: "OK", miles: 200 }, deadheadMiles: 0, updatedAt: "2026-10-06T12:00:00Z" },
] as any;
const period = weekOf("2026-10-02");
ok("week of Monday", period === "2026-09-28" && weekEnd(period) === "2026-10-04");
const exp = [{ id: "e", driverId: "d1", status: "approved", category: "lumper", amount: 80, note: "", createdAt: "2026-09-30T10:00:00Z" }] as any;
const adv = [{ id: "adv1", driverId: "d1", amount: 900, at: "2026-09-29T00:00:00Z" }] as any;
const r1 = buildPayRun({ driver, period, loads: pl, trucks: ptrucks, expenses: exp, advances: adv, runs: [], now: "x" });
ok("loads in the week, team load split in half", r1.lines.length === 2 && r1.lines.find((l) => l.loadId === "B")!.pay === 500 && r1.lines.find((l) => l.loadId === "A")!.pay === 500);
ok("reimbursement added", r1.gross === 1080);
ok("both deductions the first time", r1.deductions.length === 2);
ok("advance taken only as far as it fits; escrow only up to the cap", r1.advances[0].amount === 900 && r1.escrow === 50 && r1.net === 1080 - 75 - 900 - 50);
const paid1 = { ...r1, status: "paid", paidAt: "2026-10-05T10:00:00Z" } as any;
const r2 = buildPayRun({ driver, period: "2026-10-05", loads: pl, trucks: ptrucks, expenses: [], advances: [{ ...adv[0], amount: 1500 }], runs: [paid1], now: "x" });
ok("next week: once-deduction not again, advance remainder carried", r2.deductions.length === 1 && r2.advances[0]?.amount === Math.min(600, 250 - 45));
ok("next week never negative", r2.net >= 0);
const big = buildPayRun({ driver: { ...driver, deductions: [], escrow: undefined }, period, loads: pl, trucks: ptrucks, expenses: [], advances: [{ id: "a2", driverId: "d1", amount: 5000, at: "2026-09-29T00:00:00Z" }], runs: [], now: "x" });
ok("a big advance takes the whole check, not more", big.net === 0 && big.advances[0].amount === 1000);
ok("a load paid in one run isn't paid again", buildPayRun({ driver, period, loads: pl, trucks: ptrucks, expenses: [], advances: [], runs: [{ ...paid1, id: "other", period: "2026-09-21" }], now: "x" }).lines.length === 0);
const forms = form1099s([paid1], [driver, { id: "d2", name: "W2 Person", taxForm: "w2" } as any], 2026);
ok("1099: gross minus reimbursements, contractors only", forms.length === 1 && forms[0].compensation === 1000 && forms[0].reimbursed === 80 && forms[0].mustFile === false);
ok("pay CSV has a header and a row", payRunsCsv([r1], [driver]).split("\n").length === 2);

// Contracts
const lane = { id: "l1", origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 239, rate: 1150, equipmentType: "Dry Van", days: [1, 3, 5], pickupTime: "07:00", active: true } as any;
ok("Mon/Wed/Fri in the next week", JSON.stringify(upcomingPickups(lane, "2026-10-02", "2026-10-09")) === '["2026-10-02","2026-10-05","2026-10-07","2026-10-09"]');
ok("skips ones already made", upcomingPickups({ ...lane, madeThrough: "2026-10-05" }, "2026-10-02", "2026-10-09").length === 2);
ok("inactive lane makes nothing", upcomingPickups({ ...lane, active: false }, "2026-10-02", "2026-10-09").length === 0);
ok("only direct shippers", contractLoadsDue([{ id: "s", direct: true, lanes: [lane] }, { id: "b", lanes: [lane] }] as any, "2026-10-02").length === 4);

// Lanes
const lh = laneHistory([
  { stage: "delivered", lane: { originState: "TX", destState: "OK", miles: 200, marketRpm: 2.5 }, bookedRate: 600, pickupAt: "2026-08-03T00:00:00Z", createdAt: "x" },
  { stage: "delivered", lane: { originState: "TX", destState: "OK", miles: 200, marketRpm: 2.5 }, rpm: 3.1, pickupAt: "2026-09-03T00:00:00Z", createdAt: "x" },
  { stage: "offered", lane: { originState: "TX", destState: "OK", miles: 200, marketRpm: 2.5 }, bookedRate: 900, pickupAt: "2026-09-03T00:00:00Z", createdAt: "x" },
] as any);
ok("lane: booked loads only, by month, vs market", lh.length === 1 && lh[0].loads === 2 && lh[0].points.length === 2 && lh[0].vsMarket === 0.22 && lh[0].trend === 0.1);

// Faults
ok("fault severity", faultSeverity({ code: "SPN 100 FMI 1", description: "Engine oil pressure low" }) === "critical" && faultSeverity({ code: "SPN 3251 FMI 0", description: "DPF pressure" }) === "critical" && faultSeverity({ code: "X", description: "Battery voltage low", lamp: "amber" }) === "warn" && faultSeverity({ code: "X", description: "Info" }) === "info");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
