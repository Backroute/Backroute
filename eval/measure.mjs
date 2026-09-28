// One command for the AI's report card, once the app has a real Claude key:
//
//   EVAL_SECRET=... npm run measure -- --base https://your-app.vercel.app [--quick] [--n 300] [--runs 2]
//
// 1. Checks the app is reachable, the AI is on, and the eval secret matches.
// 2. Scores how the AI reads messages (eval/run.mjs): drivers' texts, brokers' emails, owners' questions, in every
//    language and typing style the generator makes. Dry run: nothing is sent or saved.
// 3. Plays whole conversations with simulated brokers and drivers (eval/sim.mjs), on practice carriers the app makes
//    (sandbox: nothing leaves), and has each judged for how human and how right it was.
// 4. Writes eval/report-<date>.md with the numbers and a go / not yet against the bar below, and exits 1 on "not yet".
//
// Cost: roughly one AI call per message scored plus a few dozen per conversation. --quick is about a tenth of it.
import fs from "node:fs";
import { spawn } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc), []));
const base = String(args.base ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const quick = args.quick === "true";
const n = Number(args.n ?? (quick ? 60 : 300));
const runs = Number(args.runs ?? (quick ? 1 : 2));

/** The bar for real carriers. */
export const BAR = { understood: 0.95, human: 4.0, captured: 0.9, hardRuleBreaks: 0 };

const say = (s) => console.log(s);
const here = (f) => new URL(f, import.meta.url);

async function preflight() {
  if (!process.env.EVAL_SECRET) throw new Error("Set EVAL_SECRET here and on the app (the same value).");
  let status;
  try {
    status = await fetch(`${base}/api/channels/status`).then((r) => r.json());
  } catch {
    throw new Error(`Can't reach ${base}. Is the app running? (--base)`);
  }
  if (!status?.channels?.ai) throw new Error(`The AI is off on ${base}: set ANTHROPIC_API_KEY there.`);
  const probe = await fetch(`${base}/api/eval/turn`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EVAL_SECRET}` }, body: "{}" });
  // The endpoint hides itself (404) unless the secret is set on the app and matches; an empty question is a 400.
  if (probe.status === 404) throw new Error("The app turned the eval secret down: set EVAL_SECRET on the app, the same value as here.");
  if (probe.status === 503) throw new Error(`The AI is off on ${base}: set ANTHROPIC_API_KEY there.`);
}

function run(script, extra) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [here(script).pathname, "--base", base, ...extra], { stdio: "inherit", env: process.env });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const pct = (x) => (x === null || x === undefined ? "n/a" : `${Math.round(100 * x)}%`);

function report() {
  const words = fs.existsSync(here("./results.json")) ? JSON.parse(fs.readFileSync(here("./results.json"), "utf8")) : null;
  const sim = fs.existsSync(here("./sim-results.json")) ? JSON.parse(fs.readFileSync(here("./sim-results.json"), "utf8")) : null;
  const understood = words?.total?.n ? words.total.ok / words.total.n : null;
  const results = sim?.results ?? [];
  const broke = results.filter((r) => r.checks?.some((c) => c.critical && !c.ok));
  const deals = results.filter((r) => r.money?.max);
  const captured = deals.length ? deals.reduce((s, r) => s + r.money.rate / r.money.max, 0) / deals.length : null;
  const judged = results.filter((r) => r.verdict);
  const human = judged.length ? judged.reduce((s, r) => s + r.verdict.human, 0) / judged.length : null;

  const checks = [
    { label: `Messages understood ≥ ${pct(BAR.understood)}`, value: pct(understood), ok: understood !== null && understood >= BAR.understood },
    { label: "No hard rule broken in any conversation", value: `${broke.length} broke one`, ok: results.length > 0 && broke.length === 0 },
    { label: `Money captured ≥ ${pct(BAR.captured)} of what brokers would pay`, value: pct(captured), ok: captured !== null && captured >= BAR.captured },
    { label: `Sounds human ≥ ${BAR.human}/5 (judged)`, value: human === null ? "n/a (scripted run)" : `${human.toFixed(1)}/5`, ok: human !== null && human >= BAR.human },
  ];
  const go = checks.every((c) => c.ok);
  const worst = words ? Object.entries(words.by ?? {}).map(([k, v]) => ({ k, rate: v.ok / v.n, v })).sort((a, b) => a.rate - b.rate).slice(0, 6) : [];

  const lines = [
    `# AI report card, ${new Date().toISOString().slice(0, 10)}`,
    "",
    `App: ${base} · ${quick ? "quick run" : "full run"} · ${words?.total?.n ?? 0} messages, ${results.length} conversations`,
    "",
    `## ${go ? "Go: ready for real carriers" : "Not yet"}`,
    "",
    "| Bar | Result | |",
    "| --- | --- | --- |",
    ...checks.map((c) => `| ${c.label} | ${c.value} | ${c.ok ? "✓" : "✗"} |`),
    "",
    "## Where it reads messages worst",
    "",
    ...(worst.length ? worst.map((w) => `- ${w.k}: ${pct(w.rate)} (${w.v.ok}/${w.v.n})`) : ["- (no message run)"]),
    "",
    "Every miss is in eval/results.json.",
    "",
    "## Conversations",
    "",
    ...results.map((r) => {
      const bad = (r.checks ?? []).filter((c) => !c.ok);
      return `- ${bad.some((c) => c.critical) ? "✗" : bad.length ? "!" : "✓"} **${r.id}**${r.run > 1 ? ` #${r.run}` : ""}: ${r.error ? `error: ${r.error}` : r.outcome}${r.verdict ? ` Human ${r.verdict.human}/5.` : ""}${bad.length ? ` Missed: ${bad.map((c) => c.label).join("; ")}.` : ""}${r.verdict?.mistakes?.length ? ` Judge: ${r.verdict.mistakes.join("; ")}` : ""}`;
    }),
    "",
    "Transcripts are in eval/sim-results.json.",
  ];
  const file = here(`./report-${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return { go, file: file.pathname, checks };
}

try {
  say(`Measuring the AI on ${base} (${quick ? "quick" : "full"}: ${n} messages, ${runs} run${runs === 1 ? "" : "s"} of each conversation)\n`);
  await preflight();
  say("── Reading messages");
  await run("./run.mjs", ["--n", String(n)]);
  say("\n── Whole conversations");
  await run("./sim.mjs", ["--runs", String(runs)]);
  const { go, file, checks } = report();
  say(`\n${go ? "GO" : "NOT YET"}`);
  for (const c of checks) say(`  ${c.ok ? "✓" : "✗"} ${c.label}: ${c.value}`);
  say(`\nReport: ${file}`);
  process.exit(go ? 0 : 1);
} catch (e) {
  console.error(`\nCan't measure: ${e.message}`);
  process.exit(2);
}
