// Backroute voice server: natural, interruptible phone calls for the AI dispatcher.
//
// Twilio streams the call's audio here (Media Streams). Speech goes to Deepgram for live transcription; when the caller
// finishes a sentence, the words go to the Backroute app (/api/voice/turn), which runs the same AI, tools and rules as
// every other channel and returns what to say. That's spoken with ElevenLabs and streamed back into the call. If the
// caller starts talking while the AI is speaking, the AI stops and listens (barge-in).
//
// It's a long-running process, so it runs outside Vercel (Fly.io, Render, Railway, a small VM). See DEPLOY.md.
//
// Settings:
//   PORT                   default 8080
//   APP_URL                the Backroute app, e.g. https://app.backroute.com
//   VOICE_SERVER_SECRET    shared with the app; signs each call's parameters and the turn requests
//   DEEPGRAM_API_KEY       speech to text
//   ELEVENLABS_API_KEY     text to speech
//   ELEVENLABS_VOICE_ID    the voice (one multilingual voice covers the supported languages)
//   DEEPGRAM_URL, ELEVENLABS_BASE   only to point somewhere else (testing)

import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 8080);
const APP = (process.env.APP_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.VOICE_SERVER_SECRET ?? "";
const DG_URL = process.env.DEEPGRAM_URL ?? "wss://api.deepgram.com/v1/listen";
const EL_BASE = (process.env.ELEVENLABS_BASE ?? "https://api.elevenlabs.io").replace(/\/$/, "");
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? "";
const SILENCE_MS = 12000;
// On hold (after the app pressed a key on a phone menu, or someone said "hold on"): wait quietly this long before giving up.
const HOLD_MS = 10 * 60_000;
const KEYTERMS = ["reefer", "dry van", "flatbed", "rate con", "BOL", "POD", "lumper", "detention", "TONU", "deadhead", "bobtail", "drop and hook", "MC number", "weigh station", "blowout", "34 reset"];

/** The same signature the app puts on the stream's parameters. */
export function sign(kind, carrier, ref, callSid) {
  return crypto.createHmac("sha256", SECRET).update(`${kind}|${carrier}|${ref}|${callSid}`).digest("hex");
}

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

class Call {
  constructor(twilio) {
    this.twilio = twilio;
    this.streamSid = null;
    this.params = null;
    this.dg = null;
    this.speaking = null; // { abort: AbortController, id }
    this.heard = []; // final pieces of the current sentence
    this.busy = false; // waiting on the app
    this.ending = false;
    this.marks = 0;
    this.silence = null;
    this.reprompted = false;
    this.holding = false;
  }

  send(obj) {
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify(obj));
  }

  async start(msg) {
    this.streamSid = msg.start.streamSid;
    const p = msg.start.customParameters ?? {};
    const callSid = msg.start.callSid;
    if (!SECRET || !p.token || p.token !== sign(p.kind, p.carrier, p.ref, callSid)) {
      log("refused a stream with a bad signature");
      return this.twilio.close();
    }
    this.holding = p.hold === "1";
    const { hold: _hold, ...rest } = p;
    this.params = { ...rest, callSid };
    this.listen();
    await this.say(this.holding ? "" : (p.opening ?? "Hello."));
  }

  listen() {
    const q = new URLSearchParams({ encoding: "mulaw", sample_rate: "8000", channels: "1", model: "nova-3", language: this.params.lang ?? "en", interim_results: "true", endpointing: "400", utterance_end_ms: "1000", vad_events: "true", smart_format: "true" });
    // Trucking words Deepgram should listen for (keyterm prompting), so "reefer" and "lumper" come through right.
    if ((this.params.lang ?? "en") === "en") for (const term of KEYTERMS) q.append("keyterm", term);
    this.dg = new WebSocket(`${DG_URL}?${q}`, { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } });
    this.dg.on("message", (raw) => this.heardFromDeepgram(JSON.parse(raw.toString())));
    this.dg.on("error", (e) => log("deepgram error", e.message));
  }

  heardFromDeepgram(m) {
    if (m.type !== "Results" && m.type !== "UtteranceEnd") return;
    if (m.type === "Results") {
      const text = (m.channel?.alternatives?.[0]?.transcript ?? "").trim();
      if (!text) return;
      this.stopSilenceTimer();
      // The caller talks over the AI: stop speaking and listen.
      if (this.speaking) this.bargeIn();
      if (m.is_final) this.heard.push(text);
      if (!m.speech_final) return;
    }
    const said = this.heard.join(" ").trim();
    this.heard = [];
    if (said) void this.turn(said);
  }

  bargeIn() {
    this.speaking?.abort.abort();
    this.speaking = null;
    this.send({ event: "clear", streamSid: this.streamSid });
  }

  async turn(said) {
    if (this.busy || this.ending) return;
    this.busy = true;
    try {
      const res = await fetch(`${APP}/api/voice/turn`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ ...this.params, said }),
        signal: AbortSignal.timeout(25000),
      });
      const answer = res.ok ? await res.json() : { reply: "Sorry, I'm having trouble on my end. Someone from the office will call you back.", hangUp: true };
      // The app pressed a key on their phone menu: Twilio moves the call to a new stream, this one is done.
      if (answer.redirected) return;
      this.holding = !!answer.hold;
      if (answer.hangUp) this.ending = true;
      await this.say(answer.reply);
    } catch (e) {
      log("turn failed", e.message);
      this.ending = true;
      await this.say("Sorry, I'm having trouble on my end. Someone from the office will call you back.");
    } finally {
      this.busy = false;
    }
  }

  /** Speaks, streaming the audio into the call as it's made. Resolves when it's sent (or cut off). */
  async say(text) {
    if (!text) return this.afterSpeaking();
    const abort = new AbortController();
    const me = { abort };
    this.speaking = me;
    try {
      const res = await fetch(`${EL_BASE}/v1/text-to-speech/${VOICE}/stream?output_format=ulaw_8000&optimize_streaming_latency=3`, {
        method: "POST",
        headers: { "content-type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
        body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`tts ${res.status}`);
      for await (const chunk of res.body) {
        if (this.speaking !== me) return;
        this.send({ event: "media", streamSid: this.streamSid, media: { payload: Buffer.from(chunk).toString("base64") } });
      }
      // Twilio echoes the mark back once the audio before it has played.
      this.send({ event: "mark", streamSid: this.streamSid, mark: { name: `said-${++this.marks}` } });
    } catch (e) {
      if (e.name !== "AbortError") log("tts failed", e.message);
      if (this.speaking === me) this.speaking = null;
    }
  }

  played() {
    this.speaking = null;
    this.afterSpeaking();
  }

  afterSpeaking() {
    if (this.ending) return this.twilio.close(); // The TwiML after <Connect> hangs up.
    this.startSilenceTimer();
  }

  startSilenceTimer() {
    this.stopSilenceTimer();
    if (this.holding) {
      // Hold music isn't speech: nothing to answer, and no "are you still there?". Give up after a long while.
      this.silence = setTimeout(() => {
        this.ending = true;
        this.twilio.close();
      }, HOLD_MS);
      return;
    }
    this.silence = setTimeout(() => {
      if (this.reprompted) {
        this.ending = true;
        return void this.say("I'll let you go. Text or call back anytime.");
      }
      this.reprompted = true;
      void this.say("Are you still there?");
    }, SILENCE_MS);
  }

  stopSilenceTimer() {
    if (this.silence) clearTimeout(this.silence);
    this.silence = null;
  }

  close() {
    this.stopSilenceTimer();
    this.speaking?.abort.abort();
    if (this.dg && this.dg.readyState === WebSocket.OPEN) this.dg.send(JSON.stringify({ type: "CloseStream" }));
    this.dg?.close();
  }
}

const server = http.createServer((req, res) => {
  // For the host's health check.
  res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "text/plain" });
  res.end(req.url === "/health" ? "ok" : "not found");
});
const wss = new WebSocketServer({ server, path: "/stream" });

wss.on("connection", (twilio) => {
  const call = new Call(twilio);
  twilio.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (m.event === "start") void call.start(m);
    else if (m.event === "media" && call.dg?.readyState === WebSocket.OPEN) call.dg.send(Buffer.from(m.media.payload, "base64"));
    else if (m.event === "mark") call.played();
    else if (m.event === "stop") twilio.close();
  });
  twilio.on("close", () => call.close());
});

if (!APP || !SECRET) log("APP_URL and VOICE_SERVER_SECRET must be set");
server.listen(PORT, () => log(`voice server on ${PORT}`));
