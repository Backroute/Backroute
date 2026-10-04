// Haggling like a dispatcher, against the stand-ins: several rounds on the phone with a reason each time, the freight
// checked before booking, walking away politely and hearing the broker out when they come back, and a driver asking
// where to park. Run after money-e2e (it uses the carrier and the TQL broker the earlier tests built).
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return null; };
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`) || "null");
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  const xml = await (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
  // What's spoken, as plain text.
  return [...xml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => m[1]).join(" ").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
const key = db(`select inbound_key from carriers where id = '${cid}'`);
let n = 0;
const RUN = Date.now().toString(36);
async function email(subject, text) {
  const body = { MessageID: `pm-neg-${RUN}-${++n}`, From: "loads@tql.test", FromName: "Kim at TQL", FromFull: { Email: "loads@tql.test", Name: "Kim at TQL" }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<neg-${RUN}-${n}@tql.test>` }], Attachments: [] };
  const res = await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`email webhook ${res.status}`);
  await sleep(2500);
}
const pmAfter = (i) => read("postmark").slice(i).map((x) => x.body);

/** A load negotiating with TQL, copied from TQL-5501 with its own lane and price. */
function newLoad(id, ref, patch) {
  const data = { id, referenceNumber: ref, stage: "negotiating", truckId: null, bookedRate: null, invoice: null, rateCon: null, rateConReading: null, detentionClaims: [], documents: [], tripChecklist: {}, deadheadMiles: 0, weight: 0, equipmentType: "Dry Van", lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 500 }, pickupAt: new Date(Date.now() + 3 * 86400000).toISOString(), market: null, updatedAt: new Date().toISOString(), ...patch };
  db(`delete from loads where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, ${patch.truckId ? `'${patch.truckId}'` : "null"}, 'negotiating', data || '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TQL-5501'`);
}

(async () => {
  settings({ minRpm: 2.5, autonomy: "rules", detentionPerHour: 75, tonuFee: 200 });

  // ── On the phone: several rounds, each with a reason, the freight checked, then booked ─────────────────
  // 500 miles at $2.50 → the owner's lowest is $1,250. The lane pays $3.00 a mile today, so the AI aims for at least
  // 90% of that ($1,350) and opens at $1,600.
  // A free truck in Dallas for the loads here, so the AI can tell a broker where it is.
  db(`insert into trucks (id, carrier_id, unit_number, data) values ('neg-t', '${cid}', 'N1', '{"id":"neg-t","unitNumber":"N1","status":"available","equipmentType":"Dry Van","currentCity":"Dallas","currentState":"TX","currentLoadId":null,"nextLoadId":null}'::jsonb) on conflict do nothing`);
  newLoad("neg-1", "NEG-1", { truckId: "neg-t", targetRate: 1600, market: { rpm: 3, high: 3.4, source: "test" }, bookRequest: { ask: 1600, askedAt: new Date().toISOString(), status: "sent" } });
  const q = `?carrier=${encodeURIComponent(cid)}&load=neg-1`;
  const call = { From: "+14695550199", To: "+14695550111" };
  let tw = await twilio(`/api/channels/voice/broker${q}`, { ...call, CallSid: "CAN1", Direction: "outbound-api", AnsweredBy: "human" });
  check("the AI opens like a dispatcher: who it is, which load, is it still available (no price yet)", /This call is transcribed\. I'm calling on your Dallas to Memphis load, NEG-1, picking up .*Is it still available\?/.test(tw) && !/dollars/.test(tw), tw.slice(0, 400));
  const turn = `/api/channels/voice/broker/turn${q}`;
  const c0 = read("claude").length;
  tw = await twilio(turn, { ...call, CallSid: "CAN1", SpeechResult: "yeah it's available, 38,000 pounds of paper, appointments are set" });
  check("it gets the freight details first: noted, it fits", /DETAILS:.*It fits our truck/.test(tw) && load("NEG-1").commodity === "paper" && load("NEG-1").weight === 38000 && /8 AM pickup/.test(load("NEG-1").appointmentNote ?? ""), tw.slice(0, 300));
  const sys = read("claude").slice(c0).map((x) => JSON.stringify(x.body.system ?? "")).find((t) => t.includes("Facts you can give the broker")) ?? "";
  check("it can answer the broker's questions: where the truck is, how far, the MC", /Truck N1, a dry van, is empty in Dallas, TX\./.test(sys) && /right by the pickup/.test(sys) && /Our MC is/.test(sys) && !/Our ask/.test(sys), sys.slice(sys.indexOf("Facts"), sys.indexOf("Facts") + 300));
  tw = await twilio(turn, { ...call, CallSid: "CAN1", SpeechResult: "what do you need on it?" });
  check("asked what it needs: our number, per mile too, with a reason", /OUR-PRICE:.*Say we'd need 1600 dollars all in \(3\.20 a mile\)\. Reason to give:/.test(tw), tw.slice(0, 300));
  tw = await twilio(turn, { ...call, CallSid: "CAN1", SpeechResult: "I've only got 1200 on it" });
  check("a low offer: it comes down a little (to $1,525), and says why (the market)", /Counter: say you can come down to 1525 dollars all in\. Reason to give: Lanes like this are paying about \$3\.00 a mile right now\./.test(tw), tw.slice(0, 400));
  tw = await twilio(turn, { ...call, CallSid: "CAN1", SpeechResult: "still 1200, that's all I have" });
  check("they don't move: it holds, with a different reason", /Counter: hold at 1525 dollars all in; they haven't moved\. Reason to give: (?!Lanes like this)/.test(tw), tw.slice(0, 300));
  tw = await twilio(turn, { ...call, CallSid: "CAN1", SpeechResult: "alright, I can do 2.80 a mile" });
  check("a rate per mile ($2.80 × 500 = $1,400): close to its next step, over the owner's lowest: it takes it", /Accept: 1400 dollars works/.test(tw), tw.slice(0, 300));
  tw = await twilio(turn, { ...call, CallSid: "CAN1", SpeechResult: "ok 1400 works, book it" });
  const neg1 = load("NEG-1");
  check("booked at $1,400, and it asks for detention and TONU on the rate con", /BOOKED:.*detention and TONU on the rate con/.test(tw) && neg1.bookRequest.status === "accepted" && neg1.bookRequest.ask === 1400, tw.slice(0, 300));
  check("every number said on the call is on record", (neg1.bookRequest.history ?? []).map((h) => `${h.by}${h.amount}`).join(",") === "them1200,us1525,them1200,us1525,them1400,us1400", JSON.stringify(neg1.bookRequest.history));

  // ── A broker who came up a long way last time: smaller steps now ────────────────────────────────────────
  // On NEG-1 TQL went from $1,200 to $1,400 (17%), so on average they come up 10% or more. A dispatcher remembers:
  // with them, come down slower.
  newLoad("neg-5", "NEG-5", { targetRate: 2000, lane: { origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 600 }, bookRequest: { ask: 2000, askedAt: new Date().toISOString(), status: "sent" } });
  const q5 = `?carrier=${encodeURIComponent(cid)}&load=neg-5`;
  await twilio(`/api/channels/voice/broker${q5}`, { ...call, CallSid: "CAN5", Direction: "outbound-api", AnsweredBy: "human" });
  tw = await twilio(`/api/channels/voice/broker/turn${q5}`, { ...call, CallSid: "CAN5", SpeechResult: "I've got 1700 on it" });
  check("TQL usually comes up a long way: the first counter gives up less ($2,000 → $1,975, not $1,925)", /come down to 1975 dollars/.test(tw), tw.slice(0, 300));
  const sys5 = read("claude").slice(-6).map((x) => JSON.stringify(x.body.system ?? "")).join(" ");
  check("...and the AI knows it: 'they usually come up about N%'", /usually come up about \d+% from their first number/.test(sys5), sys5.slice(sys5.indexOf("History with this broker"), sys5.indexOf("History with this broker") + 260));

  // ── Close after a round: meet in the middle (a broker with no history) ─────────────────────────────────
  newLoad("neg-4", "NEG-4", { brokerId: "broker-no-history", targetRate: 2000, lane: { origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 600 }, bookRequest: { ask: 2000, askedAt: new Date().toISOString(), status: "sent" } });
  const q4 = `?carrier=${encodeURIComponent(cid)}&load=neg-4`;
  await twilio(`/api/channels/voice/broker${q4}`, { ...call, CallSid: "CAN4", Direction: "outbound-api", AnsweredBy: "human" });
  tw = await twilio(`/api/channels/voice/broker/turn${q4}`, { ...call, CallSid: "CAN4", SpeechResult: "I've got 1700 on it" });
  const first4 = /come down to 1925/.test(tw);
  tw = await twilio(`/api/channels/voice/broker/turn${q4}`, { ...call, CallSid: "CAN4", SpeechResult: "I can go 1850" });
  check("close after a round ($1,925 vs $1,850): it offers to meet in the middle at $1,900", first4 && /Counter: say you're close and offer to meet in the middle at 1900 dollars all in/.test(tw), tw.slice(0, 300));
  tw = await twilio(`/api/channels/voice/broker/turn${q4}`, { ...call, CallSid: "CAN4", SpeechResult: "ok 1900 works, book it" });
  check("...and they take it: booked at $1,900", /BOOKED:/.test(tw) && load("NEG-4").bookRequest.status === "accepted" && load("NEG-4").bookRequest.ask === 1900, tw.slice(0, 300));

  // ── Too heavy for the truck: it won't book it, however good the price ─────────────────────────────────
  newLoad("neg-2", "NEG-2", { targetRate: 1600, bookRequest: { ask: 1600, askedAt: new Date().toISOString(), status: "sent" } });
  const q2 = `?carrier=${encodeURIComponent(cid)}&load=neg-2`;
  await twilio(`/api/channels/voice/broker${q2}`, { ...call, CallSid: "CAN2", Direction: "outbound-api", AnsweredBy: "human" });
  tw = await twilio(`/api/channels/voice/broker/turn${q2}`, { ...call, CallSid: "CAN2", SpeechResult: "sure, it's 47,500 pounds of steel" });
  check("47,500 lbs in a dry van: over the legal limit, it passes on the load", /We can't haul it: at 47,500 pounds it's over what our dry van can legally carry/.test(tw) && load("NEG-2").stage === "declined", tw.slice(0, 300));
  tw = await twilio(`/api/channels/voice/broker/turn${q2}`, { ...call, CallSid: "CAN2", SpeechResult: "fine, 1600 works, book it" });
  check("...and can't be talked into booking it anyway", /Not booked: at 47,500 pounds/.test(tw) && load("NEG-2").bookRequest.status !== "accepted", tw.slice(0, 300));

  // ── Email: walking away politely, then hearing them out when they come back ─────────────────────────────
  // The truck is free again (the phone loads are done with), so a comeback is worth hearing.
  db(`delete from loads where carrier_id = '${cid}' and id in ('neg-1', 'neg-4')`);
  newLoad("neg-3", "NEG-3", { truckId: "neg-t", targetRate: 1475, bookRequest: { ask: 1475, opening: 1700, rounds: 3, countered: true, brokerOffer: 1000, askedAt: new Date().toISOString(), status: "sent" } });
  let pm0 = read("postmark").length;
  await email("Re: NEG-3 Dallas to Memphis", "Sorry, we can do $900 on NEG-3, that's it.");
  const passMail = await waitFor(() => pmAfter(pm0).find((m) => /NEG-3/.test(m.Subject + m.TextBody)));
  check("three counters in and still far under the owner's lowest: it walks away politely, door open", !!passMail && /We can't make \$900 work; \$1,475 all in is as low as we can go/.test(passMail.TextBody) && /reply here and we'll jump on it/.test(passMail.TextBody), passMail?.TextBody);
  check("...and the truck is free for other loads", (await waitFor(() => load("NEG-3").stage === "declined")) !== null && !!load("NEG-3").bookRequest.passedAt);
  pm0 = read("postmark").length;
  await email("Re: NEG-3 Dallas to Memphis", "OK, we can do $1,300 on NEG-3 if you still have the truck.");
  const back = await waitFor(() => pmAfter(pm0).find((m) => /NEG-3/.test(m.Subject + m.TextBody)));
  check("they come back over the owner's lowest while the truck's free: it takes it, with detention and TONU terms", !!back && /\$1,300 all in works for us on NEG-3/.test(back.TextBody) && /detention at \$75\/hour after 2 hours free, and TONU at \$200/.test(back.TextBody), back?.TextBody);
  check("...and the load is back on", (await waitFor(() => load("NEG-3").stage === "negotiating" && load("NEG-3").bookRequest.status === "accepted")) !== null, JSON.stringify(load("NEG-3").bookRequest));

  // ── A driver needs somewhere to park ──────────────────────────────────────────────────────────────────
  const t0 = read("twilio").length;
  const b0 = read("boards").length;
  const url = `${BASE}/api/channels/sms`;
  const params = { From: "+12145550148", To: "+14695550199", Body: "where can I park tonight?", MessageSid: `SM-neg-${RUN}` };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) }).then((x) => x.text());
  await sleep(3500);
  const said = [r.replace(/&apos;/g, "'"), ...read("twilio").slice(t0).filter((x) => x.params.To === "+12145550148").map((x) => x.params.Body)].join(" ");
  const search = read("boards").slice(b0).find((x) => x.board === "places");
  check("a driver asks where to park: the AI looks up truck parking near the truck and texts it", /NEARBY:.*Love's Travel Stop/.test(said) && /open now/.test(said) && search?.body?.textQuery === "truck parking", said.slice(0, 300));

  db(`delete from loads where carrier_id = '${cid}' and id in ('neg-1', 'neg-2', 'neg-3', 'neg-4')`);
  db(`delete from trucks where carrier_id = '${cid}' and id = 'neg-t'`);
  settings({ detentionPerHour: 50, tonuFee: 150 });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
