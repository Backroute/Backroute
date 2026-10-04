// Natural calls against the stand-ins: the app hands the call's audio to the voice server, which transcribes it
// (fake Deepgram), asks the app what to say (/api/voice/turn), speaks it (fake ElevenLabs), stops when interrupted, and
// hangs up when the AI does. The test plays Twilio's part of the Media Stream.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync, spawn } = require("child_process");
const WebSocket = require(ROOT + "/voice-server/node_modules/ws");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
const paramsOf = (twiml) => Object.fromEntries([...twiml.matchAll(/<Parameter name="(\w+)" value="([^"]*)"\/>/g)].map((m) => [m[1], m[2].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")]));
async function restartDev(extra) {
  execSync(`fuser -k 3210/tcp >/dev/null 2>&1 || true`);
  await sleep(1500);
  execSync(`cd ${ROOT} && bash -c 'source ${S}/fakes/env.sh; ${extra.map((f) => `source ${f};`).join(" ")} (setsid nohup npm run dev -- -p 3210 > /tmp/nextdev.log 2>&1 < /dev/null &)'`);
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    try { if ((await fetch(`${BASE}/api/channels/status`)).ok) return; } catch {}
  }
  throw new Error("dev server didn't come back");
}

/** Plays Twilio: opens the stream, collects what the AI says (as text, since the fake voice's audio is text). */
function stream(params, callSid) {
  const ws = new WebSocket("ws://localhost:3013/stream");
  const got = { media: [], events: [], closed: false };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    got.events.push(m.event);
    if (m.event === "media") got.media.push(Buffer.from(m.media.payload, "base64").toString());
    if (m.event === "mark") setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ event: "mark", streamSid: "MZ1", mark: m.mark })), 50); // "played"
  });
  ws.on("close", () => (got.closed = true));
  const opened = new Promise((r) => ws.on("open", r));
  return {
    got,
    async start() {
      await opened;
      ws.send(JSON.stringify({ event: "connected" }));
      ws.send(JSON.stringify({ event: "start", start: { streamSid: "MZ1", callSid, customParameters: params } }));
    },
    speak(kind, words) {
      ws.send(JSON.stringify({ event: "media", streamSid: "MZ1", media: { payload: Buffer.from(`${kind}:${words}`).toString("base64") } }));
    },
    heard() {
      return got.media.join("");
    },
    close: () => ws.close(),
  };
}
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(100); } return false; };

(async () => {
  // The voice server and its stand-ins, and the app with VOICE_SERVER_URL set.
  execSync(`fuser -k 3011/tcp 3012/tcp 3013/tcp >/dev/null 2>&1 || true`);
  const fakes = spawn("node", [`${S}/fakes/voice-fakes.cjs`], { stdio: "ignore" });
  const server = spawn("node", [ROOT + "/voice-server/server.mjs"], {
    env: { ...process.env, PORT: "3013", APP_URL: BASE, VOICE_SERVER_SECRET: "voice-secret", DEEPGRAM_API_KEY: "dg-key", DEEPGRAM_URL: "ws://localhost:3011/v1/listen", ELEVENLABS_API_KEY: "el-key", ELEVENLABS_BASE: "http://localhost:3012", ELEVENLABS_VOICE_ID: "voice-1", NO_PROXY: "localhost,127.0.0.1" },
    stdio: ["ignore", fs.openSync(`${S}/fakes/voice-server.log`, "w"), fs.openSync(`${S}/fakes/voice-server.log`, "a")],
  });
  await restartDev([`${S}/fakes/env-boards.sh`, `${S}/fakes/env-voice.sh`]);
  check("the voice server answers its health check", (await fetch("http://localhost:3013/health")).ok);

  // Marcus is at the pickup.
  const t101 = db(`select id from trucks where carrier_id = '${cid}' and unit_number = '101'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'vc-1', carrier_id, '${t101}', 'at_pickup', data || '{"id":"vc-1","referenceNumber":"VC-1","stage":"at_pickup","truckId":"${t101}"}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' on conflict do nothing`);
  db(`update trucks set data = data || '{"currentLoadId":"vc-1","status":"on_load"}'::jsonb where id = '${t101}'`);

  const twiml = await twilio("/api/channels/voice", { From: "+12145550148", To: "+14695550199", CallSid: "CAV1" });
  const p = paramsOf(twiml);
  check("with a voice server set, the app hands the call's audio to it (and hangs up when it's done)", /<Connect><Stream url="ws:\/\/localhost:3013\/stream">/.test(twiml) && /<\/Connect><Hangup\/>/.test(twiml) && p.kind === "driver" && p.lang === "en" && p.token?.length === 64 && /AI dispatcher for Titan Freight/.test(p.opening), twiml.slice(0, 300));

  const call = stream(p, "CAV1");
  await call.start();
  await until(() => call.heard().includes("What do you need?"));
  check("the AI opens the call in its own voice", /^AUDIO:Hi Marcus, this is the AI dispatcher for Titan Freight LLC/.test(call.heard()), call.heard().slice(0, 120));
  const voice = read("voice");
  const dg = voice.find((v) => v.service === "deepgram");
  check("speech goes to Deepgram as the phone's audio, in the driver's language", !!dg && /encoding=mulaw/.test(dg.url) && /sample_rate=8000/.test(dg.url) && /language=en/.test(dg.url) && dg.auth === "Token dg-key", dg?.url);
  check("and the voice is made at the phone's format", voice.some((v) => v.service === "elevenlabs" && /output_format=ulaw_8000/.test(v.url) && v.key === "el-key" && /\/voice-1\/stream/.test(v.url)));

  const before = call.got.media.length;
  call.speak("SAY", "I'm loaded and rolling");
  await until(() => call.got.media.length > before);
  check("the driver says they're loaded: the load moves, same as on a text", await until(() => db(`select stage from loads where id = 'vc-1' and carrier_id = '${cid}'`) === "in_transit"), db(`select stage from loads where id = 'vc-1' and carrier_id = '${cid}'`));
  // They talk over the answer: the AI stops.
  const clears = call.got.events.filter((e) => e === "clear").length;
  call.speak("HMM", "wait");
  await until(() => call.got.events.filter((e) => e === "clear").length > clears, 5000);
  check("talking over the AI stops it (barge-in)", call.got.events.filter((e) => e === "clear").length > clears, call.got.events.slice(-8).join(","));
  check("what was said is logged like any call", db(`select count(*) from channel_messages where carrier_id = '${cid}' and counterparty = 'call:cav1' and body = 'I''m loaded and rolling' and data->>'realtime' = 'true'`) === "1");

  await sleep(500);
  call.speak("SAY", "ok bye");
  check("goodbye: the AI says bye and the stream closes, which ends the call", await until(() => call.got.closed, 15000) && /AUDIO:Bye, drive safe/.test(call.heard()), call.heard().slice(-120));

  // The owner calls the line: the same natural call, answered from the fleet data.
  const ot = await twilio("/api/channels/voice", { From: "+12145550100", To: "+14695550199", CallSid: "CAVO1" });
  const op = paramsOf(ot);
  check("the owner's call goes through the voice server too", /<Connect><Stream/.test(ot) && op.kind === "owner" && /your AI dispatcher for Titan Freight LLC/.test(op.opening), ot.slice(0, 300));
  const oc = stream(op, "CAVO1");
  await oc.start();
  await until(() => oc.heard().includes("What do you need?"));
  oc.speak("SAY", "how are my trucks doing");
  check("...and the owner hears the AI's answer in its voice", await until(() => /OWNER-REPLY/.test(oc.heard())), oc.heard().slice(-160));
  oc.close();

  // Someone who isn't Twilio with this call's signature gets nothing.
  const fake = stream({ ...p, token: "0".repeat(64) }, "CAV1");
  await fake.start();
  check("a stream with a wrong signature is shut", await until(() => fake.got.closed, 5000) && fake.got.media.length === 0);
  check("the app's turn endpoint refuses anyone without the secret", (await fetch(`${BASE}/api/voice/turn`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer nope" }, body: JSON.stringify({ ...p, callSid: "CAV1", said: "hi" }) })).status === 401);

  // Punjabi isn't covered by the streaming speech services: those calls keep taking turns.
  const ana = JSON.parse(db(`select data from drivers where carrier_id = '${cid}' and phone_last10 = '9725550163'`));
  db(`update drivers set data = jsonb_set(data, '{prefs,language}', '"pa"') where carrier_id = '${cid}' and phone_last10 = '9725550163'`);
  const pa = await twilio("/api/channels/voice", { From: "+19725550163", To: "+14695550199", CallSid: "CAV2" });
  check("a Punjabi-speaking driver's call stays turn by turn", pa.includes("<Gather") && !pa.includes("<Stream") && pa.includes('language="pa-IN"'));
  db(`update drivers set data = jsonb_set(data, '{prefs,language}', '"${ana.prefs?.language ?? "es"}"') where carrier_id = '${cid}' and phone_last10 = '9725550163'`);

  db(`update trucks set data = data || '{"currentLoadId":null,"status":"available"}'::jsonb where id = '${t101}'`);
  db(`update loads set stage = 'delivered', data = data || '{"stage":"delivered"}'::jsonb where id = 'vc-1' and carrier_id = '${cid}'`);
  server.kill();
  fakes.kill();
  // Back to turn-by-turn calls for the tests after this one.
  await restartDev([`${S}/fakes/env-boards.sh`]);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
