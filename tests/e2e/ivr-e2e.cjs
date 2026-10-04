// Phone menus and hold on calls the AI places: the right key for carrier sales (or road service), quiet on hold,
// and a person picking up gets the AI again. Run after negotiate-e2e (uses its carrier and the TQL broker).
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
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
const digits = (xml) => xml.match(/<Play digits="w([^"]+)"\/>/)?.[1] ?? null;
const says = (xml) => /<Say/.test(xml);
const holdN = (xml) => Number(xml.match(/hold=(\d+)/)?.[1] ?? 0);

(async () => {
  const data = { id: "ivr-1", referenceNumber: "IVR-1", stage: "negotiating", truckId: null, targetRate: 1600, bookRequest: { ask: 1600, askedAt: new Date().toISOString(), status: "sent" }, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 }, pickupAt: new Date(Date.now() + 2 * 86400000).toISOString(), updatedAt: new Date().toISOString() };
  db(`delete from loads where carrier_id = '${cid}' and id = 'ivr-1'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'ivr-1', carrier_id, null, 'negotiating', data || '${JSON.stringify(data)}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TQL-5501'`);
  const q = `?carrier=${encodeURIComponent(cid)}&load=ivr-1`;
  const call = { From: "+14695550199", To: "+13125550142", Direction: "outbound-api" };
  const turn = `/api/channels/voice/broker/turn${q}`;
  await twilio(`/api/channels/voice/broker${q}`, { ...call, CallSid: "CAIVR1", AnsweredBy: "human" });

  let tw = await twilio(turn, { ...call, CallSid: "CAIVR1", SpeechResult: "Thank you for calling TQL. For accounting, press 1. For carrier sales, press 2. For all other calls, press 0." });
  check("a phone menu: presses 2 for carrier sales, says nothing, and listens", digits(tw) === "2" && !says(tw) && holdN(tw) === 1, tw.slice(0, 300));
  tw = await twilio(`${turn}&hold=1`, { ...call, CallSid: "CAIVR1", SpeechResult: "" });
  check("hold music (no speech): keeps waiting quietly", !says(tw) && holdN(tw) === 2 && !/Hangup/.test(tw), tw.slice(0, 200));
  tw = await twilio(`${turn}&hold=2`, { ...call, CallSid: "CAIVR1", SpeechResult: "Please hold while we connect your call." });
  check("'please hold': waits, doesn't answer", !says(tw) && holdN(tw) === 3, tw.slice(0, 200));
  tw = await twilio(`${turn}&hold=3`, { ...call, CallSid: "CAIVR1", SpeechResult: "TQL, this is Kim, what can I do for you?" });
  check("a person picks up: the AI talks again", says(tw) && holdN(tw) === 0, tw.slice(0, 200));
  const log = db(`select string_agg(body, ' | ' order by id) from channel_messages where carrier_id = '${cid}' and counterparty = 'broker-call:caivr1'`);
  check("the menu, the key pressed and the hold are in the call's record (so the AI knows it was transferred)", /For carrier sales, press 2/.test(log) && /\(pressed 2, carrier sales\)/.test(log) && /Please hold/.test(log), log.slice(0, 300));
  const sys = JSON.parse(fs.readFileSync(`${S}/fakes/claude.jsonl`, "utf8").trim().split("\n").at(-1)).body;
  check("the AI is told to say who it is again after a menu, hold or transfer", /someone new picks up after a transfer, say who you are/.test(JSON.stringify(sys.system)));

  // Other ways menus are read out.
  const menus = [
    ["Press 3 for dispatch. Press 4 for billing.", "3"],
    ["Carrier services, press 5. Accounts payable, press 6.", "5"],
    ["For English, press one. Para español, oprima dos.", "1"],
    ["If you are a carrier calling about a load, press 2. For all other inquiries, press 9.", "2"],
    ["For billing press 1, for claims press 2, to speak with an operator press 0.", "0"],
  ];
  let n = 0;
  for (const [said, want] of menus) {
    const sid = `CAIVRM${++n}`;
    const got = digits(await twilio(turn, { ...call, CallSid: sid, SpeechResult: said }));
    check(`"${said.slice(0, 48)}…" → presses ${want}`, got === want, got);
  }
  // Stuck in a menu that keeps coming back: after two tries it asks for a person (0), then gives up.
  const loop = "For accounting, press 1. For claims, press 3.";
  const presses = [];
  for (let i = 0; i < 5; i++) presses.push(digits(await twilio(turn, { ...call, CallSid: "CAIVRLOOP", SpeechResult: loop })) ?? "hangup");
  check("a menu with nothing for carriers: the operator (0), and it gives up rather than loop forever", presses.join(",") === "0,0,0,0,hangup", presses.join(","));

  // A repair shop's menu: road service.
  const truck = db(`select id from trucks where carrier_id = '${cid}' limit 1`);
  db(`update trucks set data = data || '{"roadside":{"where":"I-40 mile 12","shops":[{"name":"Big Rig Tire","phone":"(901) 555-0177"}],"calling":0,"loadId":null}}'::jsonb where carrier_id = '${cid}' and id = '${truck}'`);
  const shopTurn = `/api/channels/voice/shop/turn?carrier=${encodeURIComponent(cid)}&truck=${encodeURIComponent(truck)}`;
  tw = await twilio(shopTurn, { ...call, CallSid: "CASHOP1", SpeechResult: "Thanks for calling Big Rig Tire. For sales, press 1. For 24 hour road service, press 2." });
  check("a repair shop's menu: presses 2 for road service", digits(tw) === "2", tw.slice(0, 200));
  db(`update trucks set data = data - 'roadside' where carrier_id = '${cid}' and id = '${truck}'`);

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
