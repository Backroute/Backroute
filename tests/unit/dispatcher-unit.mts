// The dispatcher's judgment (lib/agent/judgment): what earns a higher ask, what looks like a scam, loads a driver
// won't run, gear a truck lacks, a broker reposting, and the same freight from two brokers.
import { fullModeReady, reportCard } from "../../src/lib/report-card.ts";
import { eldQuiet } from "../../src/lib/agent/eld.ts";
import { askPremiums, betterTwin, driverWontRun, gearAsked, gearMissing, hazmatText, highValue, MAX_PREMIUM, pickupWeekday, redFlags, repostOf, repostPremium, touchFreight, twinOf, withPremium } from "../../src/lib/agent/judgment.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

// Wednesday Oct 14 2026, 10:00 Central.
const now = Date.parse("2026-10-14T15:00:00Z");
const H = 3600_000;

// ── When a load is picked up, at the dock ──
ok("Saturday at the dock, even when it's Sunday in UTC", pickupWeekday("2026-10-18T03:00:00Z", "TX") === 6, pickupWeekday("2026-10-18T03:00:00Z", "TX"));
ok("no time, no day", pickupWeekday(undefined, "TX") === null);

// ── What earns more ──
const plain = askPremiums({ pickupAt: new Date(now + 30 * H).toISOString(), originState: "TX" }, now);
ok("a next-day weekday load earns nothing extra", plain.factor === 1 && plain.reasons.length === 0, plain);
const weekend = askPremiums({ pickupAt: "2026-10-17T14:00:00Z", originState: "TX" }, now);
ok("a Saturday pickup: 5% more, said why", Math.abs(weekend.factor - 1.05) < 1e-9 && weekend.reasons[0] === "weekend pickup", weekend);
const rush = askPremiums({ pickupAt: new Date(now + 3 * H).toISOString(), originState: "TX" }, now);
ok("picks up within hours: 6% more", Math.abs(rush.factor - 1.06) < 1e-9 && rush.reasons.includes("picks up within 6 hours"), rush);
const past = askPremiums({ pickupAt: new Date(now - 3 * H).toISOString(), originState: "TX" }, now);
ok("a pickup already past isn't short notice", past.factor === 1, past);
const haz = askPremiums({ originState: "TX", notes: "Placarded, UN1993, driver must have hazmat endorsement" }, now);
ok("hazmat in the notes: 10% more", Math.abs(haz.factor - 1.1) < 1e-9 && haz.reasons.includes("hazmat"), haz);
const all = askPremiums({ pickupAt: "2026-10-17T14:00:00Z", originState: "TX", hazmat: true, notes: "Electronics, high value. Driver assist unload.", commodity: "TVs" }, now);
ok("several together are capped", all.factor === MAX_PREMIUM && all.reasons.length === 4, all);
ok("the ask goes up in steps of $25", withPremium(2000, { factor: 1.05, reasons: [] }) === 2100 && withPremium(1990, { factor: 1, reasons: [] }) === 1990);

// ── Words in a posting ──
ok("touch freight, said many ways", touchFreight("Driver assist required") && touchFreight("floor loaded, hand unload") && touchFreight("Driver must unload") && !touchFreight("No touch, drop and hook"));
ok("high-value freight", highValue("Pharmaceuticals") && highValue("load of copper wire") && !highValue("paper towels"));
ok("hazmat words", hazmatText("HAZMAT class 3") && hazmatText("UN 1203") && !hazmatText("general freight"));

// ── What looks wrong ──
const bait = redFlags({ rate: 4200, miles: 600, notes: null }, { rpm: 2.4 });
ok("2.9× the market is flagged, with what to do", bait.length === 1 && /2\.9× the market/.test(bait[0]) && /FMCSA/.test(bait[0]), bait);
ok("a good rate isn't", redFlags({ rate: 1800, miles: 600 }, { rpm: 2.4 }).length === 0);
ok("short loads pay more a mile: not flagged", redFlags({ rate: 900, miles: 80 }, { rpm: 2.4 }).length === 0);
ok("no market: only something wildly high", redFlags({ rate: 5000, miles: 600 }, null).length === 1 && redFlags({ rate: 2400, miles: 600 }, null).length === 0);
const fee = redFlags({ rate: 1500, miles: 600, notes: "Carrier must pay a $250 dispatch fee upfront via Zelle" }, { rpm: 2.4 });
ok("asked to pay first: flagged as a scam", fee.length === 1 && /pay something first/.test(fee[0]), fee);

// ── Loads a driver won't run ──
const d = { prefs: { avoidCities: ["Chicago", " New York "], noTouchFreight: true } };
ok("a city they avoid, either end", driverWontRun(d, { originCity: "chicago", destinationCity: "Dallas" }) === "doesn't go to chicago" && driverWontRun(d, { originCity: "Dallas", destinationCity: "New York" }) === "doesn't go to New York");
ok("touch freight they said no to", driverWontRun(d, { originCity: "Dallas", destinationCity: "Austin", notes: "Driver unload" }) === "doesn't do touch freight");
ok("otherwise fine", driverWontRun(d, { originCity: "Dallas", destinationCity: "Austin", notes: "Drop and hook" }) === null && driverWontRun(undefined, { originCity: "Chicago", destinationCity: "x" }) === null);

// ── Gear ──
ok("gear a load asks for", gearAsked("Must have 6 tarps, 8 straps and 2 load bars").join() === "tarps,straps,load_locks");
ok("chain of custody isn't chains", !gearAsked("chain of custody form").includes("chains"));
ok("a truck missing tarps can't take it", gearMissing({ gear: ["straps"] }, "Tarps required").join() === "tarps");
ok("a truck with no gear listed isn't checked", gearMissing({}, "Tarps required").length === 0);

// ── Posted again ──
ok("posted again, higher", JSON.stringify(repostOf({ listedRate: 1800, repostCount: 0 }, 1950)) === JSON.stringify({ count: 1, higher: true }));
ok("posted again, same price", repostOf({ listedRate: 1800 }, 1800).higher === false);
ok("a repost earns 3%, three posts 6%", repostPremium(1).factor === 1.03 && repostPremium(2).factor === 1.06 && repostPremium(0).factor === 1);

// ── The same freight from two brokers ──
const load = (id: string, brokerId: string, rate: number, at: string, stage = "offered") =>
  ({ id, brokerId, stage, listedRate: rate, targetRate: rate, referenceNumber: id, lane: { origin: "Dallas", destination: "Memphis" }, pickupAt: at }) as never;
const loads = [load("a", "b1", 1800, "2026-10-15T14:00:00Z"), load("old", "b3", 2500, "2026-10-15T14:00:00Z", "delivered")];
ok("same lane, two hours apart, another broker: a twin", (twinOf(loads, { brokerId: "b2", originCity: "dallas", destinationCity: "memphis", pickupAt: "2026-10-15T16:00:00Z" }) as { id: string } | undefined)?.id === "a");
ok("a day apart isn't", !twinOf(loads, { brokerId: "b2", originCity: "Dallas", destinationCity: "Memphis", pickupAt: "2026-10-16T14:00:00Z" }));
ok("the same broker isn't a twin", !twinOf(loads, { brokerId: "b1", originCity: "Dallas", destinationCity: "Memphis", pickupAt: "2026-10-15T14:00:00Z" }));
const brokers = [{ id: "b1", avgDaysToPay: 45 }, { id: "b2", avgDaysToPay: 20 }];
ok("the better twin pays more", (betterTwin(load("x", "b1", 1900, ""), load("y", "b2", 1800, ""), brokers) as { id: string }).id === "x");
ok("on a tie, the faster payer", (betterTwin(load("x", "b1", 1800, ""), load("y", "b2", 1800, ""), brokers) as { id: string }).id === "y");

// ── The ELD going quiet on a load ──
const at = (h: number) => new Date(now - h * H).toISOString();
ok("quiet 3 hours, driver on duty: asked", eldQuiet({ position: { lat: 0, lon: 0, at: at(3), source: "motive" } }, { hosStatus: "driving" }, now) === 3);
ok("an hour isn't long", eldQuiet({ position: { lat: 0, lon: 0, at: at(1), source: "motive" } }, { hosStatus: "driving" }, now) === null);
ok("asleep in the berth isn't quiet", eldQuiet({ position: { lat: 0, lon: 0, at: at(5), source: "motive" } }, { hosStatus: "sleeper" }, now) === null);
ok("no ELD, nothing to say", eldQuiet({}, undefined, now) === null);

// ── Measured like a dispatcher ──
const day = 86400_000;
const done = (i: number, truckId: string, rate: number, extra: object = {}) =>
  ({ id: `d${i}`, referenceNumber: `D${i}`, stage: "delivered", truckId, bookedRate: rate, lane: { origin: "A", originState: "TX", destination: "B", destState: "TN", miles: 500 }, documents: [], createdAt: new Date(now - 5 * day).toISOString(), updatedAt: new Date(now - 2 * day).toISOString(), pickupAt: new Date(now - 4 * day + i * 3600_000).toISOString(), deliveryAt: new Date(now - 3 * day).toISOString(), tripChecklist: { unloadedAt: new Date(now - 3 * day).toISOString() }, ...extra }) as never;
const twelve = Array.from({ length: 12 }, (_, i) => done(i, i % 2 ? "t1" : "t2", i % 2 ? 1500 : 1200, { market: { rpm: 2.5, source: "x" } }));
const asks = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, createdAt: new Date(now - day).toISOString(), status: "resolved", resolvedBy: "carrier", resolvedAt: new Date(now - day).toISOString(), approved: i !== 0 }) as never);
const rc = reportCard(twelve, asks, now);
ok("the owner's yeses counted", rc.approvals?.yes === 9 && rc.approvals.of === 10, rc.approvals);
ok("the split between trucks", rc.spread?.top === 9000 && rc.spread.bottom === 7200 && rc.spread.trucks === 2, rc.spread);
const ready = fullModeReady(rc);
ok("12 loads, 9 in 10 yeses, on time, over market: ready", ready.ready, ready.checks);
const early = fullModeReady(reportCard(twelve.slice(0, 3), [], now));
ok("three loads and nothing asked: not yet, and says why", !early.ready && early.checks[0].now === "3 so far" && early.checks[1].now === "nothing asked yet", early.checks);
const under = fullModeReady(reportCard(twelve.map((l) => ({ ...(l as object), market: { rpm: 3.5, source: "x" } })) as never, asks, now));
ok("under the market: not ready", !under.ready && !under.checks[3].met, under.checks[3]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
