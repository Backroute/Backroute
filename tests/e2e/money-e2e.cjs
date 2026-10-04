// Round D1 against the stand-ins: market rates in pricing, invoices with detention, lumper and TONU, fraud checks
// (double brokering, lookalike domains, bank-detail scams), check-call emails, and carrier setup portals.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const OWNER = execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString();
const auth = { authorization: `Bearer ${OWNER}` };
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`) || "null");
const sent = (i) => read("postmark").slice(i).map((x) => x.body);
const esc = (like) => db(`select status || '|' || coalesce(data->>'complexity','') || '|' || (data->>'reason') from escalations where carrier_id = '${cid}' and data->>'reason' like '${like.replace(/'/g, "''")}' order by (data->>'createdAt') desc limit 1`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
let n = 0;
async function email(from, name, subject, text, attachments = []) {
  const body = { MessageID: `pm-money-${++n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<money-${n}@x.test>` }], Attachments: attachments };
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await sleep(3000);
}
async function upload(kind, name, bytes, loadId) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "image/jpeg" }), name);
  form.set("kind", kind);
  form.set("loadId", loadId);
  const res = await fetch(`${BASE}/api/files`, { method: "POST", headers: auth, body: form });
  return res.json();
}
const inDays = (d, hhmm) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10) + "T" + hhmm;
// A copy of CFP-88213 (Truck 101's first load) with a new id and whatever changes the test needs.
const copyLoad = (id, patch, stage) => db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, truck_id, '${stage}', data || '${JSON.stringify({ id, stage, ...patch })}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' on conflict do nothing`);
const freeTrucks = () => {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);
};

(async () => {
  settings({ autonomy: "rules", driverCheckins: false, factoringEmail: null, setupProfiles: [{ name: "MyCarrierPackets", url: "https://mycarrierpackets.com/titan" }] });
  freeTrucks();
  const acmeId = db(`select id from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'dispatch@acmefreight.test'`);

  // ── Market rates ─────────────────────────────────────────────────────────
  fs.writeFileSync(`${S}/fakes/feed2.json`, JSON.stringify([{ loadNumber: "MEM-NSH-1", originCity: "Memphis", originState: "TN", destinationCity: "Nashville", destinationState: "TN", pickupLocal: inDays(1, "09:00"), equipment: "Dry Van", rate: 600, miles: 210, brokerName: "Acme Freight", brokerEmail: "dispatch@acmefreight.test", brokerMc: "555001" }]));
  await fetch(`${BASE}/api/integrations`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ kind: "load_feed", url: "http://localhost:3009/feed2.json", format: "json", name: "Test feed" }) });
  let b0 = read("boards").length;
  let p0 = read("postmark").length;
  await cron();
  const m = load("MEM-NSH-1");
  const q = read("boards").slice(b0).find((x) => x.board === "rates");
  check("the lane's market rate is looked up with the service's key", !!q && q.auth === "rates-key" && /o=Memphis,TN&d=Nashville,TN&e=VAN/.test(q.path), q?.path);
  check("posted $600, market $3.20 a mile ($675): the AI opens over the market, with room for a broker who always pushes back ($725), under the market's top", m?.targetRate === 725 && m.market?.rpm === 3.2 && m.market.source === "Test rates", `${m?.targetRate} ${JSON.stringify(m?.market)}`);
  check("...and the book request goes at it (by email, or by phone for an empty truck)", sent(p0).some((x) => /MEM-NSH-1/.test(x.Subject + x.TextBody) && /Our rate is \$725 all in/.test(x.TextBody)) || (m?.bookRequest?.ask === 725 && m.stage === "negotiating"), `${m?.stage} ${m?.bookRequest?.ask}`);
  await fetch(`${BASE}/api/integrations?kind=load_feed`, { method: "DELETE", headers: auth });

  // ── Invoices with everything on them ─────────────────────────────────────
  copyLoad("acc-1", { referenceNumber: "ACC-1", bookedRate: 1850, invoice: null, documents: [], detentionClaims: [{ stop: "delivery", minutes: 240, amount: 100, draftedAt: new Date().toISOString(), sentAt: new Date().toISOString() }], brokerContactEmail: "loads@coastalfreight.test" }, "in_transit");
  const pod = await upload("pod", "pod-ACC-1.jpg", Buffer.from("fake jpeg bytes"), "acc-1");
  const lump = await upload("lumper_receipt", "lumper-ACC-1.jpg", Buffer.from("lumper receipt"), "acc-1");
  check("the lumper receipt's amount is read off it", lump.amount === 185, JSON.stringify(lump));
  const docs = [
    { id: "d1", type: "pod", name: "pod-ACC-1.jpg", generatedAt: new Date().toISOString(), status: "verified", uploadedBy: "driver", fileId: pod.id },
    { id: "d2", type: "lumper_receipt", name: "lumper-ACC-1.jpg", generatedAt: new Date().toISOString(), status: "verified", uploadedBy: "driver", fileId: lump.id, amount: lump.amount },
  ];
  db(`update loads set stage = 'delivered', data = data || '${JSON.stringify({ stage: "delivered", documents: docs })}'::jsonb where id = 'acc-1' and carrier_id = '${cid}'`);
  p0 = read("postmark").length;
  await cron();
  const inv = sent(p0).find((x) => /Invoice INV-ACC-1/.test(x.Subject));
  check("the invoice bills line haul, the detention already claimed, and the lumper", !!inv && /Line haul, all in: \$1,850/.test(inv.TextBody) && /Detention at delivery \(4 hours, claimed .*\): \$100/.test(inv.TextBody) && /Lumper \(receipt attached\): \$185/.test(inv.TextBody) && /Amount due: \$2,135/.test(inv.TextBody) && load("ACC-1").invoice.amount === 2135, inv?.TextBody?.slice(0, 300));
  check("...with the invoice, POD and lumper receipt attached", (inv?.Attachments ?? []).map((a) => a.Name).join(",") === "INV-ACC-1.pdf,pod-ACC-1.jpg,lumper-ACC-1.jpg", (inv?.Attachments ?? []).map((a) => a.Name).join(","));
  copyLoad("tonu-1", { referenceNumber: "TONU-1", bookedRate: 1200, invoice: null, documents: [], tonuFee: 150, tonuClaimedAt: new Date().toISOString(), brokerContactEmail: "loads@coastalfreight.test" }, "cancelled");
  p0 = read("postmark").length;
  await cron();
  const tinv = sent(p0).find((x) => /Invoice INV-TONU-1/.test(x.Subject));
  check("a TONU that was claimed gets its own invoice, no POD needed", !!tinv && /truck ordered, not used/.test(tinv.TextBody) && /Amount due: \$150/.test(tinv.TextBody) && tinv.Attachments.length === 1, tinv?.TextBody?.slice(0, 200));

  // ── Fraud ────────────────────────────────────────────────────────────────
  freeTrucks();
  copyLoad("dbl-1", { referenceNumber: "ACM-7777", brokerId: acmeId, brokerContactEmail: "dispatch@acmefreight.test", bookRequest: { ask: 1500, askedAt: new Date().toISOString(), status: "accepted" }, rateConReading: null, invoice: null }, "negotiating");
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ broker: "Acme Freight", brokerMc: "MC 999999", brokerEmail: "dispatch@acmefreight.test", loadNumber: "ACM-7777", totalRate: 1500, mismatches: [], otherConcerns: [], summary: "Matches." }));
  await email("dispatch@acmefreight.test", "Rosa at Acme", "Rate con ACM-7777", "Rate con attached.", [{ Name: "ACM-7777.pdf", Content: Buffer.from("%PDF-1.4 rc").toString("base64"), ContentType: "application/pdf", ContentLength: 900 }]);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);
  const dbl = esc("Possible double brokering on ACM-7777%");
  check("a rate con from a different MC than the broker booked with: not booked, the broker is asked for their own rate con, the owner told (not support)", /^open\|routine\|/.test(dbl) && /asked Acme Freight/.test(dbl) && /MC 999999/.test(dbl) && load("ACM-7777").stage === "negotiating" && JSON.parse(db(`select data from records where id = '${acmeId}' and carrier_id = '${cid}'`)).mc === "555001", dbl);
  p0 = read("postmark").length;
  await email("dispatch@acmefreigth.test", "Rosa", "Acme lanes", "Acme lanes this week: MEM to BHM van $1100. Rosa, Acme Freight, MC 555001");
  const fake = JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'dispatch@acmefreigth.test'`) || "null");
  check("an email from a domain one letter off Acme's, quoting Acme's real MC: flagged as an impostor, nothing sent", fake && !fake.authorityVerified && fake.fraudRisk === "high" && /imitates Acme Freight's acmefreight\.test/.test(fake.verifyNote) && sent(p0).length === 0, fake?.verifyNote);
  p0 = read("postmark").length;
  await email("ap@tql.test", "TQL AP", "Updated banking details", "Hi, we have changed our bank account details. Please update payment information for Titan Freight by clicking the link to verify your account.");
  check("a bank-details email: the standing answer, nothing shared, and the owner is told (not support)", /^open\|routine\|TQL AP <ap@tql\.test> asked about bank or payment details/.test(esc("TQL AP%bank or payment details%")) && sent(p0).length === 1 && /don't share, confirm or change payment or bank details by email/.test(sent(p0)[0].TextBody), esc("TQL AP%bank%"));

  // ── Check calls ──────────────────────────────────────────────────────────
  freeTrucks();
  const t101 = db(`select id from trucks where carrier_id = '${cid}' and unit_number = '101'`);
  copyLoad("cc-1", { referenceNumber: "CC-1", truckId: t101, brokerContactEmail: "loads@coastalfreight.test", deliveryAt: new Date(Date.now() + 8 * 3600000).toISOString(), rateConReading: { otherConcerns: ["Tracking app required (Macropoint)"], finesAndFees: [], summary: "" }, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 } }, "in_transit");
  db(`update trucks set data = data || '${JSON.stringify({ currentLoadId: "cc-1", status: "on_load" })}'::jsonb where id = '${t101}'`);
  p0 = read("postmark").length;
  await cron(); // The ELD puts truck 101 in Memphis first.
  const cc = sent(p0).find((x) => /^Check call: Load CC-1/.test(x.Subject));
  check("the rate con asks for tracking: the broker gets a check call with the ELD location and ETA", !!cc && /Loaded, heading to Memphis, TN/.test(cc.TextBody) && /Truck location: Memphis, TN/.test(cc.TextBody) && /ETA:/.test(cc.TextBody), cc?.TextBody?.slice(0, 250));
  p0 = read("postmark").length;
  await cron();
  check("...every 4 hours, not every round", !sent(p0).some((x) => /^Check call/.test(x.Subject)));

  // ── Setup portals ────────────────────────────────────────────────────────
  p0 = read("postmark").length;
  await email("onboarding@newbroker.test", "New Broker", "Carrier setup", "Please complete your carrier packet at https://mycarrierpackets.com/invite/abc123 so we can load you.");
  const packet = sent(p0).find((x) => x.To === "onboarding@newbroker.test");
  check("a setup request gets the papers and the carrier's setup profile links", !!packet && /Our setup profiles:\nMyCarrierPackets: https:\/\/mycarrierpackets\.com\/titan/.test(packet.TextBody), packet?.TextBody?.slice(0, 300));
  check("...and with a profile on that network already, nobody has to fill out their portal", esc("New Broker wants Titan Freight LLC set up%") === "");

  freeTrucks();
  settings({ setupProfiles: [] });
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
