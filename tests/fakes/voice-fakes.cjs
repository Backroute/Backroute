// Stand-ins for Deepgram (3011, WebSocket) and ElevenLabs (3012, HTTP). The test "speaks" by sending audio whose
// bytes are "SAY:words" (a final sentence) or "HMM:words" (words heard mid-sentence, for barge-in); the fake
// transcriber turns those into Deepgram results. The fake voice sends back "AUDIO:<text>" in slow chunks.
const http = require("http");
const fs = require("fs");
const { WebSocketServer } = require(require("path").join(__dirname, "../../voice-server/node_modules/ws"));
const log = (e) => fs.appendFileSync(`${__dirname}/voice.jsonl`, JSON.stringify(e) + "\n");
fs.writeFileSync(`${__dirname}/voice.jsonl`, "");

const dg = http.createServer();
new WebSocketServer({ server: dg }).on("connection", (ws, req) => {
  log({ service: "deepgram", url: req.url, auth: req.headers.authorization });
  ws.on("message", (data, isBinary) => {
    if (!isBinary) return;
    const text = Buffer.from(data).toString();
    const say = text.match(/^SAY:(.*)$/s);
    const hmm = text.match(/^HMM:(.*)$/s);
    if (say) ws.send(JSON.stringify({ type: "Results", is_final: true, speech_final: true, channel: { alternatives: [{ transcript: say[1] }] } }));
    else if (hmm) ws.send(JSON.stringify({ type: "Results", is_final: false, speech_final: false, channel: { alternatives: [{ transcript: hmm[1] }] } }));
  });
});
dg.listen(3011);

http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const b = JSON.parse(body || "{}");
  log({ service: "elevenlabs", url: req.url, key: req.headers["xi-api-key"], text: b.text, model: b.model_id });
  if (req.headers["xi-api-key"] !== "el-key") { res.writeHead(401); return res.end(); }
  res.writeHead(200, { "content-type": "audio/basic" });
  const audio = Buffer.from(`AUDIO:${b.text}`);
  // Long answers come out in several chunks, a little apart, like real streaming speech.
  const parts = Math.max(1, Math.ceil(audio.length / 40));
  for (let i = 0; i < parts; i++) {
    if (res.destroyed) return;
    res.write(audio.subarray(i * 40, (i + 1) * 40));
    await new Promise((r) => setTimeout(r, 150));
  }
  res.end();
}).listen(3012);
console.log("voice fakes up");
