// Load boards against the stand-ins: waiting on Backroute's agreement, then Truckstop (search, posting, a phone-only
// poster the AI calls, checks and books), DAT and a board described in JSON. Run after autonomy-e2e.
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
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const OWNER = execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString();
const auth = { authorization: `Bearer ${OWNER}` };
const get = (path) => fetch(BASE + path, { headers: auth });
const post = (path, body) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify(body) });
const del = (kind) => fetch(`${BASE}/api/integrations?kind=${encodeURIComponent(kind)}`, { method: "DELETE", headers: auth });
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`) || "null");
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const broker = (company) => JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'broker' and data->>'company' = '${company}'`) || "null");
const status = (kind) => db(`select status from carrier_integrations where carrier_id = '${cid}' and kind = '${kind}'`);
const after = (f, i) => read(f).slice(i);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
// Frees the trucks for the next board: loads they were chasing are set aside, and the per-slot search marks cleared.
function freeTrucks() {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);
}
async function restartDev(extraEnv) {
  execSync(`fuser -k 3210/tcp >/dev/null 2>&1 || true`);
  await sleep(1500);
  execSync(`cd ${ROOT} && bash -c 'source ${S}/fakes/env.sh; ${extraEnv ? `source ${extraEnv};` : ""} (setsid nohup npm run dev -- -p 3210 > /tmp/nextdev.log 2>&1 < /dev/null &)'`);
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    try { if ((await fetch(`${BASE}/api/channels/status`)).ok) return; } catch {}
  }
  throw new Error("dev server didn't come back");
}

(async () => {
  settings({ autonomy: "rules" });
  freeTrucks();
  await del("load_feed");

  // ── Before Backroute's agreement: the carrier can save their side ─────────
  let list = await (await get("/api/integrations")).json();
  check("without Backroute's board logins, Truckstop and DAT show as not available yet", list.available.truckstop === false && list.available.dat === false);
  let r = await post("/api/integrations", { kind: "truckstop", integrationId: "556677", postTrucks: true });
  let body = await r.json();
  check("the carrier can still save their Truckstop ID; it waits on the agreement", r.status === 200 && /waiting on Backroute's agreement/.test(body.status), body.status);
  let b0 = read("boards").length;
  await cron();
  check("...and nothing is searched until then", after("boards", b0).length === 0 && /Waiting on Backroute's agreement/.test(status("truckstop")), status("truckstop"));

  // ── The agreement is in place ─────────────────────────────────────────────
  await restartDev(`${S}/fakes/env-boards.sh`);
  list = await (await get("/api/integrations")).json();
  check("with the logins set, both boards are available", list.available.truckstop === true && list.available.dat === true);
  r = await post("/api/integrations", { kind: "truckstop", integrationId: "000000", postTrucks: true });
  body = await r.json();
  check("a wrong Integration ID is caught right away, in Truckstop's words", r.status === 422 && /Truckstop: Invalid Integration Id/.test(body.reason), body.reason);
  r = await post("/api/integrations", { kind: "truckstop", integrationId: "556677", postTrucks: true });
  body = await r.json();
  check("the right one connects with a test search", r.status === 200 && /test search found 2 loads/.test(body.status), body.status);

  // ── Truckstop: search, post, and a poster with only a phone number ───────
  b0 = read("boards").length;
  let t0 = read("twilio").length;
  await cron();
  const ts = after("boards", b0).filter((x) => x.board === "truckstop");
  const search = ts.find((x) => /LoadSearch/.test(x.path) && /<web1:OriginCity>memphis<\/web1:OriginCity>/.test(x.body));
  check("each free truck is searched from where it is, for its equipment", !!search && /GetLoadSearchResults/.test(search.action) && /<web1:EquipmentType>V<\/web1:EquipmentType>/.test(search.body) && /<web1:OriginState>tn<\/web1:OriginState>/.test(search.body) && /<web1:OriginRange>150<\/web1:OriginRange>/.test(search.body) && ts.some((x) => /<web1:OriginCity>fort worth</.test(x.body) && /<web1:EquipmentType>R</.test(x.body)));
  const posts = ts.filter((x) => /TruckPosting/.test(x.path));
  check("truck posts tell brokers to call the AI's line and ask for the carrier", posts.every((x) => /<web2:Comments>Call \(469\) 555-0199 and ask for Titan Freight LLC\. Our dispatch answers 24\/7\.<\/web2:Comments>/.test(x.body)), posts[0]?.body?.match(/<web2:Comments>[^<]*/)?.[0]);
  check("trucks are posted as available", posts.length === 2 && posts.some((x) => /<web2:TruckNumber>101<\/web2:TruckNumber>/.test(x.body) && /<web2:OriginCity>memphis</.test(x.body) && /<web2:DestinationState>tx</.test(x.body)), posts.length);
  const tsLoad = load("TS-9001001");
  check("the load lands on the board with the poster's details; a post with no one to call is skipped", tsLoad && tsLoad.truckId === truckBy("101").id && tsLoad.listedRate === 1400 && /Truckstop · Lone Star Brokerage/.test(tsLoad.source) && !load("TS-9001002"), tsLoad?.source);
  const call = after("twilio", t0).find((x) => x.path.endsWith("/Calls.json") && x.params.To === "+19035550123");
  check("the poster has only a phone number: within the rules, the AI calls them", !!call && tsLoad.stage === "negotiating" && tsLoad.bookRequest?.ask === 1525, `${tsLoad?.stage} ${tsLoad?.bookRequest?.ask}`);
  check("...and support isn't asked to check a broker it's about to ask for an MC", db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'reason' like 'Check broker Lone Star%'`) === "0");
  b0 = read("boards").length;
  await cron();
  check("searches every 30 minutes and posts once a day, not every round", after("boards", b0).filter((x) => x.board === "truckstop").length === 0);

  const url = new URL(call.params.Url);
  const turn = `/api/channels/voice/broker/turn${url.search}`;
  let tw = await twilio(url.pathname + url.search, { CallSid: "CAT1", From: "+14695550199", To: "+19035550123", Direction: "outbound-api", AnsweredBy: "machine_end_beep" });
  check("voicemail on a phone-only poster: no 'reply to our email', it'll call again", /We(?:'|&apos;)ll try you again shortly/.test(tw) && !/email/.test(tw) && db(`select count(*) from agent_marks where carrier_id = '${cid}' and load_id = '${tsLoad.id}' and kind = 'broker_call'`) === "0");
  tw = await twilio(url.pathname + url.search, { CallSid: "CAT2", From: "+14695550199", To: "+19035550123", Direction: "outbound-api", AnsweredBy: "human" });
  check("they pick up: the AI says who it is and asks if it's still available", /AI dispatcher for Titan Freight LLC/.test(tw) && /Is it still available\?/.test(tw), tw.slice(0, 200));
  tw = await twilio(turn, { CallSid: "CAT2", From: "+14695550199", To: "+19035550123", SpeechResult: "yeah 1525 works, book it" });
  check("before agreeing, the AI asks for their MC (it has none for them)", /BOOKED:.*Ask for their MC number/.test(tw) && load("TS-9001001").bookRequest.status !== "accepted", tw.slice(0, 300));
  let f0 = read("fmcsa").length;
  tw = await twilio(turn, { CallSid: "CAT2", From: "+14695550199", To: "+19035550123", SpeechResult: "sure, our MC is 777001" });
  const lsb = broker("Lone Star Brokerage");
  check("the MC is checked with FMCSA on the call", /MC-CHECK:.*active broker authority/.test(tw) && after("fmcsa", f0).some((x) => /777001/.test(x.path)) && lsb?.authorityVerified === true && lsb.mc === "777001", tw.slice(0, 300));
  tw = await twilio(turn, { CallSid: "CAT2", From: "+14695550199", To: "+19035550123", SpeechResult: "ok 1525 works, book it" });
  check("then it books, and asks where to send the confirmation", /BOOKED:.*email address/.test(tw) && load("TS-9001001").bookRequest.status === "accepted", tw.slice(0, 300));
  let pm0 = read("postmark").length;
  tw = await twilio(turn, { CallSid: "CAT2", From: "+14695550199", To: "+19035550123", SpeechResult: "send it to Kim at lonestarbrokerage dot test" });
  const conf = after("postmark", pm0).map((x) => x.body).find((m) => m.To === "kim@lonestarbrokerage.test");
  check("the confirmation and the carrier packet go to the email they gave", /EMAIL:/.test(tw) && !!conf && /Confirming what we agreed on the phone/.test(conf.TextBody) && /\$1,525 all in/.test(conf.TextBody) && (conf.Attachments ?? []).length >= 2 && broker("Lone Star Brokerage").email === "kim@lonestarbrokerage.test", conf?.TextBody?.slice(0, 200) ?? tw.slice(0, 200));
  // Their rate con comes back with their own load number: it's matched by the sender.
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ broker: "Lone Star Brokerage", brokerMc: "MC 777001", brokerEmail: "kim@lonestarbrokerage.test", loadNumber: "LSB-4411", totalRate: 1525, originCity: "Memphis", originState: "TN", destinationCity: "Dallas", destinationState: "TX", miles: 452, equipment: "Dry van 53'", detention: "2 hrs free, then $50/hr", paymentTerms: "Net 30", finesAndFees: [], mismatches: [], otherConcerns: [], summary: "Matches: $1,525 Memphis to Dallas." }));
  const pdf = Buffer.from("%PDF-1.4 rate con").toString("base64");
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: "pm-board-1", From: "kim@lonestarbrokerage.test", FromName: "Kim", FromFull: { Email: "kim@lonestarbrokerage.test", Name: "Kim" }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: "Rate confirmation LSB-4411", TextBody: "Rate con attached.", Headers: [{ Name: "Message-ID", Value: "<board-1@x.test>" }], Attachments: [{ Name: "LSB-4411.pdf", Content: pdf, ContentType: "application/pdf", ContentLength: 900 }] }) });
  await sleep(3000);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);
  const bookedTs = load("TS-9001001");
  check("their rate con finds the load and books it onto the truck", !!bookedTs?.rateConReading && ["booked", "dispatched"].includes(bookedTs.stage) && [truckBy("101").nextLoadId, truckBy("101").currentLoadId].includes(bookedTs.id), `${bookedTs?.stage}`);

  // ── DAT ──────────────────────────────────────────────────────────────────
  await del("truckstop");
  freeTrucks();
  r = await post("/api/integrations", { kind: "dat", userEmail: "nobody@elsewhere.test", postTrucks: true });
  body = await r.json();
  check("DAT: an email DAT doesn't know is refused", r.status === 422 && /DAT didn't accept the sign-in/.test(body.reason), body.reason);
  r = await post("/api/integrations", { kind: "dat", userEmail: "owner@titanfreight.test", postTrucks: true });
  body = await r.json();
  check("DAT connects with the carrier's DAT login", r.status === 200 && /test search found 1 load/.test(body.status), body.status);
  b0 = read("boards").length;
  pm0 = read("postmark").length;
  await cron();
  const dat = after("boards", b0).filter((x) => x.board === "dat");
  const q = dat.find((x) => x.path.endsWith("/search/v3/queries") && x.body?.criteria?.lane?.origin?.place?.city === "Memphis");
  check("DAT search: org sign-in, then the carrier's user, then the search from the truck", dat.some((x) => x.path.endsWith("/token/organization")) && dat.some((x) => x.path.endsWith("/token/user")) && !!q && q.auth === "Bearer user-tok" && q.body.criteria.lane.equipment.types[0] === "V" && q.body.criteria.maxOriginDeadheadMiles === 150);
  check("DAT posting: each truck, once", dat.filter((x) => x.path.endsWith("/posting/v2/assets")).length === 2 && dat.some((x) => x.body?.referenceId === "101" && x.body?.destination?.area?.states?.[0] === "TX"));
  const datLoad = load("DAT-M1");
  const ask = after("postmark", pm0).map((x) => x.body).find((m) => /DAT-M1/.test(m.Subject + m.TextBody));
  check("a DAT load from a checked broker: the AI emails to book it, within the rules", datLoad?.stage === "negotiating" && !!ask && ask.To === "dispatch@acmefreight.test" && /Our rate is \$1,4\d\d all in/.test(ask.TextBody), ask?.TextBody?.slice(0, 200) ?? datLoad?.stage);

  // ── A board described in JSON (123Loadboard and the like) ────────────────
  await del("dat");
  freeTrucks();
  const cfg = {
    name: "Board 123",
    searchUrl: "http://localhost:3009/board123/loads?origin={{originCity}},{{originState}}&radius={{radius}}&date={{date}}&equipment={{equipmentCode}}",
    method: "GET",
    headers: { Authorization: "Bearer b123-key" },
    listPath: "data.results",
    fields: { loadNumber: "id", originCity: "pickup.city", originState: "pickup.state", destinationCity: "dropoff.city", destinationState: "dropoff.state", pickupLocal: "pickup.date", rate: "pay", miles: "distance", equipment: "trailer", brokerName: "poster.company", brokerEmail: "poster.email", brokerPhone: "poster.phone", brokerMc: "poster.mc" },
  };
  r = await post("/api/integrations", { kind: "board", config: { ...cfg, listPath: "data.items" } });
  body = await r.json();
  check("a board set up with the wrong list path says so", r.status === 422 && /no list of loads at "data.items"/.test(body.reason), body.reason);
  r = await post("/api/integrations", { kind: "board", config: cfg });
  body = await r.json();
  check("with the right setup it connects", r.status === 200 && /test search found 1 load/.test(body.status), body.status);
  b0 = read("boards").length;
  pm0 = read("postmark").length;
  await cron();
  const b123 = after("boards", b0).find((x) => x.board === "b123" && /Memphis/.test(x.path));
  check("the search fills in the truck's city, date and equipment", !!b123 && /origin=Memphis,TN&/.test(b123.path) && /radius=150/.test(b123.path) && /equipment=V/.test(b123.path) && b123.auth === "Bearer b123-key", b123?.path);
  const ms = load("7701");
  const msAsk = after("postmark", pm0).map((x) => x.body).find((m) => m.To === "ops@midsouth.test");
  check("its loads go through the same broker check and booking", ms?.stage === "negotiating" && broker("MidSouth Logistics")?.authorityVerified === true && !!msAsk, ms?.stage);
  list = await (await get("/api/integrations")).json();
  const conn = list.connections.find((c) => c.kind === "board:board-123");
  check("the connections list shows the board and its last search, not the key", conn?.name === "Board 123" && /Connected · last search/.test(conn.status) && !JSON.stringify(list).includes("b123-key"), JSON.stringify(conn));
  await del("board:board-123");

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
