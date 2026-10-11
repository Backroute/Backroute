// Features 32-45: fuel prices from the card, the scale check, the tracking page, signed share links, a broker's
// contact changing, pay statements and trip reports as PDF.
import { cheapestByState, keepCheapest, parsePriceFile, routeStates } from "../../src/lib/fuel-prices.ts";
import { planFuel } from "../../src/lib/fuel.ts";
import { scaleOver } from "../../src/lib/scale.ts";
import { trackView } from "../../src/lib/track-view.ts";
import { readShareToken, shareToken } from "../../src/lib/agent/share-link.ts";
import { contactMoved } from "../../src/lib/agent/fraud.ts";
import { payStatementLines, tripReport, tripReportLines } from "../../src/lib/statements.ts";
import { pdfBytes } from "../../src/lib/pdf.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

// ── Fuel prices ──
const file = `Station Name,City,State,Retail Price,Your Price
Pilot #412,Texarkana,AR,3.699,3.389
Love's #301,Hope,AR,3.659,3.419
Flying J,Dallas,TX,3.459,3.199
Bad row,,ZZ,3.1,3.0
TA,Memphis,TN,3.799,3.509`;
const parsed = parsePriceFile(file);
ok("a card's price list reads by column names, a row with no real state skipped", !("error" in parsed) && parsed.stations.length === 4 && parsed.skipped === 1, parsed);
const st = "error" in parsed ? [] : parsed.stations;
ok("the card's price, with the pump price kept", st[0].price === 3.389 && st[0].retail === 3.699);
ok("cheapest by state", cheapestByState(st).AR.name === "Pilot #412" && cheapestByState(st).TX.price === 3.199);
ok("only the cheapest few per state are kept", keepCheapest([...st, ...st, ...st], 2).filter((s) => s.state === "AR").length === 2);
ok("a file with no price column is turned away", "error" in parsePriceFile("Station,City,State\nA,B,TX"));
const states = routeStates({ city: "Dallas", state: "TX" }, { city: "Memphis", state: "TN" });
ok("states on the way, in order", !!states && states[0] === "TX" && states[states.length - 1] === "TN" && states.includes("AR"), states);
const load = { id: "f1", lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 } } as never;
const plan = planFuel(load, 6.5, 0, { source: "WEX", at: "2026-10-10T12:00:00Z", stations: st });
ok("the plan uses the card's stations and says where its prices came from", !!plan && plan.source.kind === "file" && plan.stops.every((s) => ["Pilot #412", "Flying J", "TA"].some((n) => s.chain === n)), plan);
ok("no file and no sample lane: no plan, nothing made up", planFuel({ id: "x", lane: { origin: "Boise", originState: "ID", destination: "Reno", destState: "NV", miles: 420 } } as never, 6.5, 0, null) === null);

// ── Scale ──
ok("legal on every axle", scaleOver({ steer: 11800, drives: 33900, trailer: 33500, gross: 79200 }).length === 0);
const over = scaleOver({ steer: 11800, drives: 35200, trailer: 33500, gross: 80500 });
ok("over on drives and gross, worst first", over.map((o) => `${o.part}:${o.over}`).join() === "drives:1200,gross:500", over);
ok("gross worked out from the axles", scaleOver({ steer: 12000, drives: 34000, trailer: 34500, gross: 0 }).some((o) => o.part === "gross" && o.over === 500));

// ── Tracking page ──
const now = Date.parse("2026-10-11T15:00:00Z");
const moving = { id: "t1", referenceNumber: "TR-1", stage: "in_transit", lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 }, documents: [], updatedAt: "2026-10-11T10:00:00Z", pickupAt: "2026-10-11T08:00:00Z", deliveryAt: "2026-10-11T22:00:00Z", bookedRate: 2000, truckId: "k" } as never;
const truck = { id: "k", position: { lat: 34.75, lon: -92.29, at: "2026-10-11T14:50:00Z", source: "samsara" }, currentCity: "Little Rock", currentState: "AR" } as never;
const v = trackView(moving, truck, "Lone Star", now)!;
ok("where: the nearest town, not the spot", /^Near .+, AR$/.test(v.where ?? ""), v.where);
ok("an arrival time from a fresh position", !!v.eta && Date.parse(v.eta) > now);
ok("nothing about money or the driver", !JSON.stringify(v).includes("2000") && !("driver" in v));
const stale = trackView(moving, { ...(truck as object), position: { lat: 34.75, lon: -92.29, at: "2026-10-11T08:00:00Z", source: "samsara" } } as never, "Lone Star", now)!;
ok("an old position: no guessed arrival time", stale.eta === null);
ok("not booked yet: no tracking", trackView({ ...(moving as object), stage: "negotiating" } as never, truck, "x", now) === null);
const done = trackView({ ...(moving as object), stage: "delivered", documents: [{ type: "pod", status: "verified" }], tripChecklist: { unloadedAt: "2026-10-11T21:00:00Z" } } as never, truck, "x", now)!;
ok("delivered: where it is stops showing, the POD shows", done.where === null && done.podReceived && done.deliveredAt === "2026-10-11T21:00:00Z");

// ── Share links ──
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-key";
const tok = shareToken("track", "c1", "t1", now + 3600_000);
ok("a link reads back to its load", readShareToken(tok, "track", now)?.id === "t1");
ok("a tracking link isn't a shipper link", readShareToken(tok, "shipper", now) === null);
ok("an expired link is refused", readShareToken(tok, "track", now + 7200_000) === null);
const [body, sig] = tok.split(".");
const forged = Buffer.from(JSON.stringify({ k: "track", c: "c2", i: "t9", x: Math.floor(now / 1000) + 99999 })).toString("base64url");
ok("a changed link is refused", readShareToken(`${forged}.${sig}`, "track", now) === null && !!body);

// ── A broker's address changing ──
const broker = { company: "Acme Logistics", email: "jo@acmelogistics.com" } as never;
ok("same company, any rep: fine", contactMoved("sam@acmelogistics.com", broker) === null && contactMoved("x@ops.acmelogistics.com", broker) === null);
ok("another company's address: held", /not their usual acmelogistics.com/.test(contactMoved("billing@acme-payments.net", broker) ?? ""));
ok("sent through DocuSign with the rep's own email printed: fine", contactMoved("dse@docusign.net", broker, "jo@acmelogistics.com") === null);
ok("sent through DocuSign but printing someone else: held", !!contactMoved("dse@docusign.net", broker, "jo@acme-freight.co"));
ok("free mail isn't judged here", contactMoved("acme.dispatch@gmail.com", broker) === null);

// ── Pay statement and trip report ──
const run = { id: "r", carrierId: "c", driverId: "d", period: "2026-10-05", periodEnd: "2026-10-11", lines: [{ loadId: "l", ref: "TR-1", lane: "Dallas to Memphis", pay: 1200 }], extras: [{ label: "Detention", amount: 75 }], gross: 1275, deductions: [{ label: "Insurance", amount: 50 }], advances: [{ id: "a", amount: 100 }], escrow: 25, net: 1100, status: "draft", createdAt: "" } as never;
const lines = payStatementLines(run, "Lena Ortiz", { name: "Lone Star", mc: "123456" });
const text = lines.map((l) => l.text).join("|");
ok("the statement has each load, what's added and taken out, and the net", /TR-1/.test(text) && /\$75\.00/.test(text) && /-\$50\.00/.test(text) && /Advances paid back/.test(text) && /\$1,100\.00/.test(text));
const report = tripReport({ ...(moving as object), stage: "delivered", fuelCost: 300, tollCost: 20, deadheadMiles: 30, tripChecklist: { arrivedPickupAt: "2026-10-11T08:00:00Z", leftPickupAt: "2026-10-11T10:30:00Z", trailerNumber: "53104", scale: { gross: 78000, at: "" } } } as never, { fuel: [{ loadId: "t1", amount: 410 } as never], tolls: [], lumpers: 0 });
const r = (label: string) => report.rows.find((x) => x.label === label)?.value;
ok("trip report: real fuel over the estimate, time at the dock, trailer and scale", r("Fuel (1 purchase)") === "-$410.00" && r("At the dock") === "2 h 30 min" && /53104/.test(r("Trailer") ?? "") && /78,000/.test(r("Load photo, scale") ?? ""), report.rows);
const pdf = Buffer.from(pdfBytes(tripReportLines(moving, report, "Lone Star"))).toString("latin1");
const xref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
ok("the PDF is well formed: header, xref where it says, end marker", pdf.startsWith("%PDF-1.4") && pdf.slice(xref, xref + 4) === "xref" && pdf.trimEnd().endsWith("%%EOF"));
const offsets = [...pdf.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
ok("every object is where the xref says", offsets.every((o, i) => pdf.slice(o).startsWith(`${i + 1} 0 obj`)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
