// How the AI weighs one load against another (lib/choice): the hours a load ties a truck up, dead time after a Friday
// delivery, getting paid sooner, sharing good loads, what the owner's picks taught, extras a broker pays, power only;
// and the new reasons to ask more (lib/agent/judgment situationPremiums).
import { deadHours, extrasPaidPct, fairnessNudge, hoursTiedUp, netPerHour, noDetention, ownerLeanings, payerEdge, powerOnly, weekGross } from "../../src/lib/choice.ts";
import { situationPremiums } from "../../src/lib/agent/judgment.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

const now = Date.parse("2026-10-14T15:00:00Z"); // Wednesday
const H = 3600_000, DAY = 86400_000;

// ── What an hour is worth ──
const done = (net: number, miles: number) => ({ stage: "delivered", netProfit: net, lane: { miles }, deadheadMiles: 50, updatedAt: new Date(now - 5 * DAY).toISOString() }) as never;
ok("what the trucks net an hour: $1,000 on a 450-mile load with 50 empty (14 hours with docks)", netPerHour(Array(5).fill(done(1000, 450)), now) === 71);
ok("fewer than five loads: time isn't priced", netPerHour(Array(4).fill(done(1000, 450)), now) === null);

// ── Hours tied up ──
ok("today: drive, docks, and an hour's wait at the shipper", hoursTiedUp({ now, pickupAt: now + 2 * H, miles: 500, deadhead: 50 }) === 16);
ok("tomorrow: a day of waiting on top", hoursTiedUp({ now, pickupAt: now + 26 * H, miles: 500, deadhead: 50 }) === 40);
ok("a slow dock counts as it has been", hoursTiedUp({ now, pickupAt: now + 1 * H, miles: 500, deadhead: 50, dockHours: { pickup: 5 } }) === 18);

// ── Dead time ──
ok("Friday 3 PM delivery into a dead market: sits until Monday 6 AM", deadHours("2026-10-16T20:00:00Z", "TX", "weak") === 63);
ok("...half that where it's fair", deadHours("2026-10-16T20:00:00Z", "TX", "fair") === 32);
ok("...nothing where freight is strong", deadHours("2026-10-16T20:00:00Z", "TX", "strong") === 0);
ok("a Wednesday delivery: none", deadHours("2026-10-14T20:00:00Z", "TX", "weak") === 0);
ok("the day before Thanksgiving", deadHours("2026-11-25T20:00:00Z", "TX", "weak") === 16);

// ── Getting paid sooner ──
ok("a 15-day payer on $2,000: worth $10 more", payerEdge(2000, 15) === 10);
ok("a 60-day payer: $20 less", payerEdge(2000, 60) === -20);
ok("never past 2%", payerEdge(2000, 200) === -40);

// ── Sharing good loads ──
const trucks = [{ id: "a", driverId: "1" }, { id: "b", driverId: "2" }] as never;
const gross = weekGross([{ truckId: "a", stage: "delivered", bookedRate: 6000, pickupAt: new Date(now - 2 * DAY).toISOString() }, { truckId: "b", stage: "in_transit", bookedRate: 2000, pickupAt: new Date(now - DAY).toISOString() }] as never, now);
ok("the truck behind gets a nudge, the one ahead the same down", fairnessNudge("b", gross, trucks) === 100 && fairnessNudge("a", gross, trucks) === -100);

// ── What the owner's picks taught ──
const picks = [1, 2, 3].map(() => ({ brokerId: "b1", ownerPick: { at: "", overAi: true, lessDeadhead: true } })).concat([{ brokerId: "b2", ownerPick: { at: "", overAi: false } }] as never) as never;
const lean = ownerLeanings(picks);
ok("a broker the owner keeps choosing, and fewer empty miles", lean.brokers.get("b1") === 150 && !lean.brokers.has("b2") && lean.deadheadPerMile === 0.5, { b: [...lean.brokers], d: lean.deadheadPerMile });

// ── Extras a broker pays ──
const paid = (id: string, amount: number, got: number) => ({ id, brokerId: "b1", invoice: { amount, paidAt: "2026-10-01", paidAmount: got, lines: [{ label: "Line haul, all in", amount: 2000 }, { label: "Detention at pickup", amount: amount - 2000 }] } }) as never;
ok("two of three paid short: 33%", extrasPaidPct([paid("1", 2100, 2100), paid("2", 2100, 2000), paid("3", 2150, 2000)], "b1") === 33);
ok("under three: unknown", extrasPaidPct([paid("1", 2100, 2100)], "b1") === null);

// ── Words in a posting ──
ok("no detention", noDetention("NO DETENTION on this load") && noDetention("Detention: none") && !noDetention("Detention $50/hr after 2"));
ok("power only", powerOnly("Power Only, trailer at shipper") && powerOnly("power-only") && !powerOnly("dry van"));

// ── New reasons to ask more ──
const s = situationPremiums({ noDetention: true, reload: "weak", extrasPaidPct: 30 });
ok("no detention +3, a dead market +4, a broker who short-pays extras +2", Math.abs(s.factor - 1.09) < 1e-9 && s.reasons.length === 3, s);
ok("a fair market and good payers: nothing", situationPremiums({ reload: "fair", extrasPaidPct: 80 }).factor === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
