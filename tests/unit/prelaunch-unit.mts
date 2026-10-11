// Before real carriers: the AI's report card, multi-page PDFs, trusting a broker's new address, and stopping links.
import { reportCard } from "../../src/lib/report-card.ts";
import { pdfBytes } from "../../src/lib/pdf.ts";
import { claimedDomain, contactMoved } from "../../src/lib/agent/fraud.ts";
import { readShareToken, shareToken, stopped } from "../../src/lib/agent/share-link.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

// ── Report card ──
const now = Date.parse("2026-10-11T12:00:00Z");
const h = (hours: number) => new Date(now + hours * 3600_000).toISOString();
const load = (id: string, extra: object) =>
  ({ id, referenceNumber: id, stage: "delivered", truckId: "t1", lane: { origin: "A", originState: "TX", destination: "B", destState: "TN", miles: 500 }, documents: [], createdAt: h(-200), updatedAt: h(-1), bookedRate: 1500, ...extra }) as never;
const loads = [
  load("a", { pickupAt: h(-100), deliveryAt: h(-90), tripChecklist: { unloadedAt: h(-90), arrivedDeliveryAt: h(-90.5) }, market: { rpm: 2.5, source: "x" }, invoice: { number: "1", amount: 1650, draftedAt: h(-90), sentAt: h(-89), paidAt: h(-89 + 24 * 20) }, detentionClaims: [{ stop: "delivery", minutes: 180, amount: 150, draftedAt: h(-89), sentAt: h(-89) }] }),
  load("b", { pickupAt: h(-80), deliveryAt: h(-70), tripChecklist: { unloadedAt: h(-68), arrivedDeliveryAt: h(-68) }, pickedBy: "carrier", invoice: { number: "2", amount: 1500, draftedAt: h(-60), sentAt: h(-20) } }),
  load("c", { stage: "cancelled", tonuClaimedAt: h(-10), tonuFee: 250, pickupAt: h(-12) }),
  ...Array.from({ length: 5 }, (_, i) => load(`old${i}`, { imported: true, bookedRate: 1000, pickupAt: h(-24 * 200) })),
];
const r = reportCard(loads, [{ id: "e", createdAt: h(-5), status: "open" } as never], now);
ok("delivered and who booked them", r.delivered === 2 && r.bookedByAi === 1 && r.bookedByOwner === 1, r);
ok("revenue and rate a mile from the invoices", r.revenue === 3150 && r.rpm === 3.15, r);
// The line haul against the market (extras aside): $1,500 / 500 mi = $3.00 vs $2.50.
ok("against the market only where there was one, line haul only", r.vsMarket?.loads === 1 && r.vsMarket.cents === 50, r.vsMarket);
ok("extras: detention sent and the TONU", r.extras.amount === 400 && r.extras.claims === 2, r.extras);
ok("invoiced within a day: one of two", r.invoicedSameDay?.share === 0.5 && r.invoicedSameDay.of === 2);
ok("days to get paid from the one that paid", r.daysToPaid === 20);
ok("on time: the late one counts against", r.onTime?.share === 0.5, r.onTime);
ok("empty hours between one delivery and the next pickup", r.emptyHours === 10, r.emptyHours);
ok("times it asked the owner", r.askedOwner === 1);
ok("before Backroute: the imported loads' rate a mile", r.before?.rpm === 2 && r.before.loads === 5, r.before);
ok("nothing yet: nulls, not zeros", reportCard([], [], now).rpm === null && reportCard([], [], now).daysToPaid === null);

// ── Multi-page PDFs ──
const many = Array.from({ length: 120 }, (_, i) => ({ text: `Line ${i + 1}` }));
const pdf = Buffer.from(pdfBytes(many)).toString("latin1");
const count = Number(pdf.match(/\/Count (\d+)/)?.[1]);
ok("long content goes on more pages", count >= 3, count);
ok("every line is in it", pdf.includes("(Line 1)") && pdf.includes("(Line 120)"));
ok("pages are numbered", pdf.includes(`(Page 1 of ${count})`) && pdf.includes(`(Page ${count} of ${count})`));
const xref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
const offsets = [...pdf.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
ok("xref and every object where it says", pdf.slice(xref, xref + 4) === "xref" && offsets.every((o, i) => pdf.slice(o).startsWith(`${i + 1} 0 obj`)));
const one = Buffer.from(pdfBytes([{ text: "Short" }])).toString("latin1");
ok("a short one stays one page, unnumbered", /\/Count 1\b/.test(one) && !one.includes("Page 1 of"));
const pair = Buffer.from(pdfBytes([...many.slice(0, 44), { text: "Left" }, { text: "Right", gap: -14.85, x: 400 }])).toString("latin1");
ok("a right-hand column stays on its line's page", (() => { const pages = pair.split("BT"); return pages.findIndex((p) => p.includes("(Left)")) === pages.findIndex((p) => p.includes("(Right)")); })());

// ── A broker's new address, trusted ──
const broker = { company: "Acme Logistics", email: "jo@acmelogistics.com" } as never;
ok("the domain a rate con claims: the printed email first", claimedDomain("dse@docusign.net", "jo@acme-new.com") === "acme-new.com" && claimedDomain("ops@acme-new.com") === "acme-new.com" && claimedDomain("dse@docusign.net") === undefined);
ok("held before the owner trusts it", !!contactMoved("ops@acme-new.com", broker));
ok("not held once trusted", contactMoved("ops@acme-new.com", { ...(broker as object), trustedDomains: ["acme-new.com"] } as never) === null);

// ── Stopping links ──
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-key";
const tok = shareToken("track", "c1", "t1", now + 86400_000, now - 1000);
const link = readShareToken(tok, "track", now)!;
ok("a link knows when it was made, to the millisecond", link.issued === now - 1000);
ok("one made the moment after Stop sharing opens", !stopped(readShareToken(shareToken("track", "c1", "t1", now + 86400_000, now + 1), "track", now)!, new Date(now).toISOString()));
ok("links made before Stop sharing don't open", stopped(link, new Date(now).toISOString()));
ok("one made after does", !stopped(readShareToken(shareToken("track", "c1", "t1", now + 86400_000, now + 5000), "track", now)!, new Date(now).toISOString()));
process.env.SHARE_LINK_SECRET = "a-separate-secret-of-good-length";
ok("its own secret ends every old link", readShareToken(tok, "track", now) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
