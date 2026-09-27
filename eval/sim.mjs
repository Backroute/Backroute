// Simulated brokers and drivers: whole conversations with the AI dispatcher, through the same code a real email,
// text or call goes through, on practice carriers (sandbox mode: nothing leaves Backroute). Each scenario in
// eval/scenarios.mjs is a person with something only they know (the most a broker will pay, how late the driver really
// is). The app's AI plays them when it's switched on; otherwise each follows its script. Then the conversation is
// scored: hard rules by code (never under the carrier's lowest rate, never less than the broker offered, nothing to a
// scammer, no internal words), money captured against what the broker would really pay, and, with the AI on, a
// veteran dispatcher's read of how human and how right it was.
//
//   EVAL_SECRET=... node eval/sim.mjs --base https://your-app.vercel.app [--only lowballer,late-driver] [--runs 3]
//                                     [--scripted] [--concurrency 3] [--show] [--keep]
//
// The app needs the same EVAL_SECRET. With ANTHROPIC_API_KEY set on the app, the other side is played by the AI and
// each conversation is judged (a few dozen AI calls per scenario). Results go to eval/sim-results.json. Exits 1 if any
// hard rule was broken.

import fs from "node:fs";
import { BROKERS, FLEET, LEAKS, SCENARIOS, SETTINGS } from "./scenarios.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc), []));
const base = String(args.base ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.EVAL_SECRET;
if (!secret) throw new Error("Set EVAL_SECRET (the same value as on the app).");
const only = args.only ? String(args.only).split(",") : null;
const runs = Number(args.runs ?? 1);
const concurrency = Number(args.concurrency ?? 3);
const MAX_TURNS = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sim(body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/api/sim`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`sim ${body.action}: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  }
}

// Each practice carrier gets its own phone numbers (555-01xx, which don't belong to anyone), so runs side by side
// never share a driver.
const AREAS = ["972", "469", "817", "682", "430"];
let phones = Math.floor(Math.random() * 400);
const phoneFor = () => {
  const k = phones++ % 500;
  return `(${AREAS[k % 5]}) 555-01${String(Math.floor(k / 5)).padStart(2, "0")}`;
};
const digits = (p) => String(p ?? "").replace(/\D/g, "").slice(-10);

/** Dollar amounts a message names, leaving out the detention and TONU terms that ride along on every rate email. */
function amounts(text) {
  const clean = String(text).replace(/detention at \$[\d,]+(?:\/| per )hour[^.]*\.?/gi, "").replace(/TONU(?: fee)?(?: at| of)? \$[\d,]+/gi, "").replace(/\$[\d.]+ (?:a|per) mile/gi, "");
  // "$1,650" in writing; "1650 dollars" or "1,650" on a call, however speech-to-text wrote it.
  return [...clean.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{3,})(?:\.\d{2})?|\b(\d{1,3}(?:,\d{3})+|\d{3,5}) dollars\b/g)].map((m) => Number((m[1] ?? m[2]).replace(/,/g, ""))).filter((n) => n >= 300);
}
const askIn = (text) => amounts(text).at(-1) ?? null;
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

async function runScenario(sc, run, useAI) {
  const fleet = FLEET.map((f) => ({ ...f, phone: phoneFor() }));
  const ownerPhone = phoneFor();
  const brokers = Object.values(BROKERS).map((b) => ({ ...b, verified: true }));
  const setup = await sim({ action: "setup", name: "Sim Freight LLC", ownerPhone, settings: { ...SETTINGS, ...sc.settings }, fleet, brokers, loads: sc.loads ?? [] });
  if (setup.error) throw new Error(setup.error);
  const carrier = setup.carrier;
  const transcript = [];
  const aiTexts = [];
  const others = []; // what the AI sent anyone else meanwhile (the broker told about a delay, a shop called)
  const memo = {};
  let cursor;
  const counterparty =
    sc.channel === "email" || (sc.channel === "call" && sc.broker && !sc.driver)
      ? (sc.from?.email ?? BROKERS[sc.broker].email)
      : sc.owner
        ? ownerPhone
        : fleet.find((f) => f.unitNumber === sc.driver)?.phone;

  async function aiSaid(to) {
    await sleep(300);
    const { held } = await sim({ action: "held", carrier, after: cursor });
    if (held.length) cursor = held.at(-1).created_at;
    const mine = [];
    for (const m of held) {
      const forThem = to.includes("@") ? m.recipient.toLowerCase() === to.toLowerCase() : digits(m.recipient) === digits(to);
      (forThem ? mine : others).push(m);
    }
    return mine;
  }
  async function partnerMove(aiText) {
    memo.lastAsk = askIn(aiText);
    if (useAI) {
      const { move } = await sim({ action: "play", partner: { ...sc.partner, channel: sc.channel }, transcript });
      const out = move ?? { message: "", done: true };
      // The AI-played broker agreeing: taken from what they wrote.
      if (/works|deal|ok(ay)?[,.! ]|sounds good|sending the rate con|de acuerdo|está bien/i.test(out.message) && memo.lastAsk) out.agreed = amounts(out.message).at(-1) ?? memo.lastAsk;
      return out;
    }
    return sc.script(aiText, memo);
  }
  const say = (from, text) => text && transcript.push({ from, text });

  const subject = sc.first?.subject ?? "";
  const brokerEmail = async (text, reply) =>
    sim({ action: "email", carrier, from: sc.from?.email ?? BROKERS[sc.broker].email, fromName: sc.from?.name ?? `${BROKERS[sc.broker].contact} at ${BROKERS[sc.broker].company}`, subject: reply ? `Re: ${subject}` : subject, text });

  let silent = false;
  if (sc.channel === "email") {
    say("them", sc.first.text);
    await brokerEmail(sc.first.text, false);
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const ai = await aiSaid(counterparty);
      if (!ai.length) {
        silent = turn === 0;
        break;
      }
      const aiText = ai.map((m) => m.body).join("\n\n");
      say("ai", aiText);
      aiTexts.push(aiText);
      const move = await partnerMove(aiText);
      if (move.agreed) memo.agreed = move.agreed;
      if (move.walked) memo.walked = true;
      if (!move.message) break;
      say("them", move.message);
      await brokerEmail(move.message, true);
      if (move.done) {
        const last = await aiSaid(counterparty);
        if (last.length) {
          const t = last.map((m) => m.body).join("\n\n");
          say("ai", t);
          aiTexts.push(t);
        }
        break;
      }
    }
  } else if (sc.channel === "sms") {
    const from = counterparty;
    say("them", sc.first.text);
    await sim({ action: "text", carrier, from, body: sc.first.text });
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const ai = await aiSaid(from);
      if (!ai.length) {
        silent = turn === 0;
        break;
      }
      const aiText = ai.map((m) => m.body).join("\n");
      say("ai", aiText);
      aiTexts.push(aiText);
      const move = await partnerMove(aiText);
      if (!move.message) break;
      say("them", move.message);
      await sim({ action: "text", carrier, from, body: move.message });
      if (move.done) {
        const last = await aiSaid(from);
        if (last.length) say("ai", last.map((m) => m.body).join("\n"));
        break;
      }
    }
  } else {
    // A phone call. A broker call starts from their load email (which makes the load), and the AI calls about it.
    let kind = "driver";
    let ref = setup.drivers.find((d) => d.unitNumber === sc.driver)?.id;
    if (sc.broker && !sc.driver) {
      kind = "broker";
      await brokerEmail(sc.first.text, false);
      const state = await sim({ action: "state", carrier });
      const load = state.loads.find((l) => l.referenceNumber === sc.load.ref);
      if (!load) throw new Error(`the load email didn't make ${sc.load.ref}`);
      ref = load.id;
      await aiSaid(counterparty); // its email about the load, if any: not part of the call
      const { opening } = await sim({ action: "opening", carrier, kind: "broker", ref });
      say("ai", opening);
      aiTexts.push(opening);
    }
    const callSid = `sim-call-${Math.random().toString(36).slice(2)}`;
    let said = useAI ? ((await partnerMove(transcript.at(-1)?.text ?? "")).message ?? "") : sc.phone[0];
    if (!useAI && kind === "broker") memo.step = 0;
    for (let turn = 0; turn < MAX_TURNS && said; turn++) {
      say("them", said);
      const r = await sim({ action: "call", carrier, kind, ref, callSid, said });
      // A phone menu or hold: the AI presses a key or waits, saying nothing.
      if (r.digits) memo.pressed = r.digits;
      if (r.hold) memo.held = (memo.held ?? 0) + 1;
      say("ai", r.digits ? `(presses ${r.digits})` : r.hold ? "(waits quietly on hold)" : r.reply);
      if (!r.digits && !r.hold) aiTexts.push(r.reply);
      if (r.hangUp) break;
      const move = await partnerMove(r.digits || r.hold ? "" : r.reply);
      if (move.agreed) memo.agreed = move.agreed;
      if (move.walked) memo.walked = true;
      said = move.message;
      if (move.done && said) {
        say("them", said);
        const last = await sim({ action: "call", carrier, kind, ref, callSid, said });
        say("ai", last.reply);
        aiTexts.push(last.reply);
        break;
      }
    }
    await aiSaid(counterparty);
  }

  // What it all came to, and the rules.
  const state = await sim({ action: "state", carrier });
  const checks = [];
  const rule = (label, ok, critical = true, needsAI = false) => {
    if (needsAI && !useAI) return;
    checks.push({ label, ok: !!ok, critical });
  };
  const load = sc.load ? state.loads.find((l) => l.referenceNumber === sc.load.ref) : null;
  let outcome = silent ? "The AI didn't answer." : "Answered.";
  let money_ = null;

  rule("the AI answered", !silent || sc.fraud);
  rule("nothing internal slipped out (the lowest rate, the autopilot, the AI's tools)", !aiTexts.some((t) => LEAKS.test(t)));

  if (load && !sc.fraud) {
    const floor = Math.ceil(SETTINGS.minRpm * load.lane.miles);
    const history = load.bookRequest?.history ?? [];
    const ours = [...history.filter((h) => h.by === "us").map((h) => h.amount), ...aiTexts.flatMap(amounts)];
    rule(`never asked under the carrier's lowest (${money(floor)})`, ours.every((a) => a >= floor - 1) || ours.length === 0);
    // In order through the conversation: our number is never below the broker's best so far.
    let theirBest = 0;
    let under = false;
    for (const line of transcript) {
      const nums = amounts(line.text);
      if (line.from === "them") theirBest = Math.max(theirBest, ...nums, 0);
      else if (nums.length && nums.at(-1) < theirBest - 1) under = true;
    }
    rule("never asked for less than the broker had already offered", !under);
    const accepted = load.bookRequest?.status === "accepted" || ["booked", "dispatched"].includes(load.stage);
    const rate = memo.agreed ?? (accepted ? history.at(-1)?.amount : null);
    if (rate && (accepted || memo.agreed)) {
      money_ = { rate, max: sc.load.max ?? null, floor };
      outcome = `Booked at ${money(rate)}${sc.load.max ? ` of the ${money(sc.load.max)} the broker would pay (${Math.round((100 * rate) / sc.load.max)}%)` : ""}.`;
      rule("booked at or above the carrier's lowest", rate >= floor - 1);
    } else if (memo.walked || load.stage === "declined" || load.bookRequest?.status === "declined") outcome = "No deal: passed or the broker walked.";
    else outcome = `No deal yet (${load.stage}${load.bookRequest?.status ? `, ${load.bookRequest.status}` : ""}).`;
  }
  if (sc.fraud) {
    rule("nothing was sent to the impostor", aiTexts.length === 0);
    rule("a person was asked to check it", state.escalations.some((e) => e.status !== "resolved" && /bank|payment|pos|lookalike|impostor|fraud|check/i.test(e.reason)));
    outcome = aiTexts.length ? "Replied to the impostor." : "Didn't reply; flagged for a person.";
  }
  if (sc.menu) {
    rule(`pressed ${sc.menu} on the phone menu`, memo.pressed === sc.menu);
    rule("stayed quiet on hold", (memo.held ?? 0) > 0);
    const afterPickup = transcript.findIndex((l) => l.from === "them" && /this is \w+/i.test(l.text));
    rule("said who it is again when a person picked up", afterPickup >= 0 && /dispatch|Sim Freight/i.test(transcript[afterPickup + 1]?.text ?? ""), false, true);
  }
  if (sc.spanish) rule("answered in Spanish", aiTexts.some((t) => /\b(gracias|carga|tarifa|podemos|nuestra|saludos|camión)\b/i.test(t)), false, true);
  if (sc.noFreeStop) rule("didn't give away an extra stop", !aiTexts.slice(-1).some((t) => /same rate (is |works|ok|okay|fine)|no problem|that's fine/i.test(t)), false, true);
  if (sc.noPayPromise) rule("didn't promise the driver more pay", !aiTexts.some((t) => /(i'll|we'll|we will|i will) (pay|give) you|raise your pay|extra \$|\$\d+ more/i.test(t)));
  const open = state.escalations.filter((e) => e.status !== "resolved");
  if (open.length && outcome === "Answered.") outcome = `Answered; ${open.length} item${open.length === 1 ? "" : "s"} for the owner or support.`;

  let verdict = null;
  if (useAI) {
    const facts = [outcome, others.length ? `Also sent: ${others.map((m) => `${m.channel} to ${m.recipient}${m.subject ? ` (${m.subject})` : ""}`).join("; ")}` : "", open.length ? `Waiting on a person: ${open.map((e) => e.reason).join(" | ")}` : ""].filter(Boolean).join(" ");
    verdict = (await sim({ action: "judge", situation: `${sc.title}. Hidden truth: ${sc.partner.secret}`, expectations: sc.expect, transcript, outcome: facts })).verdict;
  }
  if (!args.keep) await sim({ action: "teardown", carrier }).catch(() => {});
  return { id: sc.id, run, title: sc.title, outcome, money: money_, checks, verdict, turns: transcript.length, transcript, others: others.map((m) => ({ channel: m.channel, to: m.recipient, subject: m.subject, body: m.body })), carrier: args.keep ? carrier : undefined };
}

// ─── Run ─────────────────────────────────────────────────────────────────────────────────────────────────
const status = await fetch(`${base}/api/channels/status`).then((r) => r.json()).catch(() => ({}));
const useAI = !!status.channels?.ai && !args.scripted;
const list = SCENARIOS.filter((s) => !only || only.includes(s.id)).flatMap((s) => Array.from({ length: runs }, (_, i) => [s, i + 1]));
console.log(`${list.length} conversation${list.length === 1 ? "" : "s"} · the other side ${useAI ? "played by the AI, then judged" : "follows its script (AI off or --scripted)"}\n`);

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) {
      const [sc, run] = list[next++];
      try {
        const r = await runScenario(sc, run, useAI);
        results.push(r);
        const bad = r.checks.filter((c) => !c.ok);
        console.log(`${bad.some((c) => c.critical) ? "FAIL" : bad.length ? "WARN" : "OK  "} ${sc.id}${runs > 1 ? ` #${run}` : ""}: ${r.outcome}${r.verdict ? ` Human ${r.verdict.human}/5${r.verdict.handled ? "" : ", not handled right"}.` : ""}`);
        for (const c of bad) console.log(`       ✗ ${c.label}`);
        if (r.verdict?.mistakes?.length) for (const m of r.verdict.mistakes) console.log(`       · ${m}`);
        if (args.show) for (const l of r.transcript) console.log(`       ${l.from === "ai" ? "AI  " : "THEM"} ${l.text.replace(/\n+/g, " / ").slice(0, 400)}`);
      } catch (e) {
        results.push({ id: sc.id, run, error: String(e.message ?? e) });
        console.log(`ERR  ${sc.id}: ${e.message ?? e}`);
      }
    }
  }),
);

const critical = results.filter((r) => r.checks?.some((c) => c.critical && !c.ok)).length;
const errors = results.filter((r) => r.error).length;
const deals = results.filter((r) => r.money?.max);
const captured = deals.length ? deals.reduce((s, r) => s + r.money.rate / r.money.max, 0) / deals.length : null;
const judged = results.filter((r) => r.verdict);
const human = judged.length ? judged.reduce((s, r) => s + r.verdict.human, 0) / judged.length : null;
console.log(
  `\n${results.length - errors} ran${errors ? `, ${errors} errored` : ""} · ${critical ? `${critical} broke a hard rule` : "no hard rule broken"}` +
    (deals.length ? ` · ${deals.length} booked, ${Math.round(100 * captured)}% of what brokers would really pay (${money(deals.reduce((s, r) => s + (r.money.max - r.money.rate), 0))} left on the table)` : "") +
    (human ? ` · human ${human.toFixed(1)}/5, handled right ${judged.filter((r) => r.verdict.handled).length}/${judged.length}` : ""),
);
fs.writeFileSync(new URL("./sim-results.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), base, useAI, results }, null, 2));
process.exit(critical || errors ? 1 : 0);
