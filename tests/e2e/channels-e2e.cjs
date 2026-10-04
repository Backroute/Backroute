const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
const check = (label, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();

function sign(url, params, token = "twilio-secret") {
  const payload = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", token).update(payload).digest("base64");
}
async function twilio(path, params, { badSig } = {}) {
  const url = BASE + path;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": badSig ? "nope" : sign(url, params) }, body: new URLSearchParams(params) });
  return { status: res.status, text: await res.text() };
}
const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return null; };

(async () => {
  const marcus = "+12145550148";
  // ── SMS ──
  let r = await twilio("/api/channels/sms", { From: marcus, To: "+14695550199", Body: "I'm loaded and rolling", MessageSid: "SM1" }, { badSig: true });
  check("SMS with a bad signature is refused", r.status === 403);
  r = await twilio("/api/channels/sms", { From: marcus, To: "+14695550199", Body: "I'm loaded and rolling", MessageSid: "SM1" });
  check("SMS answered at once with empty TwiML", r.status === 200 && r.text.includes("<Response></Response>"));
  const reply = await waitFor(() => read("twilio").find((x) => x.params.To === marcus && /Marked you loaded/.test(x.params.Body)));
  check("AI texted the driver back", !!reply, reply?.params.Body);
  check("load moved to in transit from the text", db(`select stage from loads where carrier_id = '${cid}'`) === "in_transit");
  const claudeReq = read("claude").find((x) => x.body.tools?.some((t) => t.name === "update_load_status"));
  check("brain got the driver's instructions, tools and fallback", !!claudeReq && claudeReq.beta?.includes("server-side-fallback") && claudeReq.body.system[1].text.includes("texting"));
  check("thread saved (in + out, by text)", db(`select string_agg(data->>'from' || ':' || (data->>'channel'), ',' order by created_at) from driver_messages where carrier_id = '${cid}' and data->>'content' not like 'New load%'`) === "driver:sms,ai:sms");
  check("activity logged for the owner", db(`select count(*) from activity where carrier_id = '${cid}' and data->>'message' like 'Marcus: on the road%'`) === "1");
  const before = read("twilio").length;
  r = await twilio("/api/channels/sms", { From: marcus, To: "+14695550199", Body: "I'm loaded and rolling", MessageSid: "SM1" });
  await sleep(3000);
  check("a retried webhook isn't handled twice", read("twilio").length === before);
  r = await twilio("/api/channels/sms", { From: "+13105550000", To: "+14695550199", Body: "hello", MessageSid: "SM2" });
  check("unknown number gets told to ask their carrier", r.text.includes("We don&apos;t have this number on file"));
  r = await twilio("/api/channels/sms", { From: "+19725550163", To: "+14695550199", Body: "STOP", MessageSid: "SM3" });
  check("STOP recorded on the driver", db(`select data->'prefs'->>'smsOptOut' from drivers where carrier_id = '${cid}' and phone_last10 = '9725550163'`) === "true");
  r = await twilio("/api/channels/sms", { From: "+19725550163", To: "+14695550199", Body: "HELP", MessageSid: "SM4" });
  check("HELP answered", r.text.includes("Reply STOP to stop texts"));

  // ── Voice ──
  r = await twilio("/api/channels/voice", { From: marcus, To: "+14695550199", CallSid: "CA1" });
  check("call answered with an AI disclosure and listening", r.text.includes("this is the AI dispatcher for Titan Freight") && r.text.includes("<Gather input=\"speech\" language=\"en-US\""), r.text.slice(0, 160));
  r = await twilio("/api/channels/voice/turn", { From: marcus, CallSid: "CA1", SpeechResult: "my truck broke down on I-35", Confidence: "0.9" });
  check("problem on the call reaches the owner", db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'source' = 'voice' and data->>'reason' like 'Marcus Bell (breakdown)%'`) === "1");
  check("AI answers and keeps listening", r.text.includes("The owner knows") && r.text.includes("<Gather"));
  r = await twilio("/api/channels/voice/turn", { From: marcus, CallSid: "CA1", SpeechResult: "ok thanks bye" });
  check("goodbye ends the call", r.text.includes("Bye, drive safe") && r.text.includes("<Hangup/>"));
  const voiceTurns = read("claude").filter((x) => Array.isArray(x.body.system) && x.body.system[1]?.text?.includes("phone call"));
  check("call keeps its history between turns", voiceTurns.at(-1).body.messages.length >= 3, `${voiceTurns.at(-1).body.messages.length} messages`);
  r = await twilio("/api/channels/voice/turn", { From: marcus, CallSid: "CA2", SpeechResult: "" });
  check("silence gets one retry", r.text.includes("didn&apos;t catch that") && r.text.includes("missed=1"));
  r = await twilio("/api/channels/voice/turn?missed=1", { From: marcus, CallSid: "CA2", SpeechResult: "" });
  check("second silence hangs up politely", r.text.includes("<Hangup/>"));

  // ── Email ──
  const key = db(`select inbound_key from carriers where id = '${cid}'`);
  const pdf = fs.readFileSync(`${S}/fakes/data/ratecon.pdf`).toString("base64");
  const email = {
    MessageID: "em-1", From: "loads@coastalfreight.test", FromName: "Dana at Coastal", FromFull: { Email: "loads@coastalfreight.test", Name: "Dana at Coastal" },
    To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: "Rate con CFP-88213", TextBody: "Attached is the rate con for CFP-88213. Please sign and return.",
    Headers: [{ Name: "Message-ID", Value: "<dana-123@coastal.test>" }], Attachments: [{ Name: "CFP-88213.pdf", Content: pdf, ContentType: "application/pdf", ContentLength: 900 }],
  };
  let res = await fetch(`${BASE}/api/channels/email?token=wrong`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(email) });
  check("email webhook needs the secret", res.status === 403);
  res = await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(email) });
  check("email accepted", res.status === 200);
  const draft = await waitFor(() => db(`select data->'draft'->>'body' from escalations where carrier_id = '${cid}' and data->'draft'->>'purpose' = 'reply'`) || null, 30000);
  check("AI drafted a reply for the owner (autopilot not on full)", !!draft && draft.includes("thanks for the rate con"), draft);
  check("draft threads the broker's email", db(`select data->'draft'->>'inReplyTo' from escalations where carrier_id = '${cid}' and data->'draft'->>'purpose' = 'reply'`) === "<dana-123@coastal.test>");
  check("attached rate con read and saved on the load", db(`select data->'rateConReading'->>'fileName' from loads where carrier_id = '${cid}'`) === "CFP-88213.pdf");
  check("nothing emailed without approval", read("postmark").length === 0);

  // ── End-of-day text ──
  res = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: "Bearer wrong" } });
  check("daily job needs the cron secret", res.status === 401);
  res = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: "Bearer cron-secret" } });
  const daily = await res.json();
  const ownerText = read("twilio").find((x) => x.params.To === "+12145550100");
  check("owner gets the end-of-day text", daily.sent === 1 && !!ownerText, ownerText?.params.Body);
})().catch((e) => { console.error(e); process.exit(1); });
