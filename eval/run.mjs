// Scores the real AI on messages from eval/corpus.mjs: each goes to the app's /api/eval/turn (dry run: nothing is
// saved or sent), and the tool the AI picked (or how it read an email) is checked against what a dispatcher would do.
//
//   EVAL_SECRET=... node eval/run.mjs --base https://your-app.vercel.app --n 300 [--seed 1] [--only driver,broker] [--concurrency 4]
//   node eval/run.mjs --count          how many different messages the generator makes
//   node eval/run.mjs --show 20        print some, without calling anything
//
// The app needs ANTHROPIC_API_KEY and the same EVAL_SECRET set. Each message is one AI call: 300 messages cost about
// what 300 driver texts do. Results and every miss go to eval/results.json.

import fs from "node:fs";
import { count, sample } from "./corpus.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc), []));
if (args.count) {
  const c = count();
  console.log(`${c.total.toLocaleString()} different messages`);
  for (const [k, v] of Object.entries(c.per)) console.log(`  ${k.padEnd(22)} ${v.toLocaleString()}`);
  process.exit(0);
}
const only = args.only ? String(args.only).split(",") : null;
if (args.show) {
  for (const s of sample(Number(args.show), Number(args.seed ?? 1), only)) console.log(`[${s.intent} · ${s.lang} · ${s.noise}] ${s.text.replace(/\n/g, " / ")}`);
  process.exit(0);
}

const base = String(args.base ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.EVAL_SECRET;
if (!secret) throw new Error("Set EVAL_SECRET (the same value as on the app).");
const items = sample(Number(args.n ?? 200), Number(args.seed ?? 1), only);
const concurrency = Number(args.concurrency ?? 4);

async function run(item) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base}/api/eval/turn`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify({ kind: item.who, text: item.text, subject: item.subject, lang: item.lang }) });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`eval endpoint ${res.status}`);
    return res.json();
  }
  return { error: "gave up" };
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < items.length) {
    const item = items[next++];
    const got = await run(item).catch((e) => ({ error: e.message }));
    const ok = !got.error && item.expect(got);
    results.push({ ...item, expect: undefined, ok, got });
    process.stdout.write(ok ? "." : "x");
  }
}));
console.log("\n");

const tally = (key) => {
  const out = {};
  for (const r of results) {
    const t = (out[r[key]] ??= { ok: 0, n: 0 });
    t.n++;
    if (r.ok) t.ok++;
  }
  return out;
};
const by = tally("intent");
const byNoise = tally("noise");
const pct = (o) => `${Math.round((100 * o.ok) / o.n)}% (${o.ok}/${o.n})`;
console.log("By intent:");
for (const [k, v] of Object.entries(by)) console.log(`  ${k.padEnd(22)} ${pct(v)}`);
console.log("By how it was typed:");
for (const [k, v] of Object.entries(byNoise)) console.log(`  ${k.padEnd(22)} ${pct(v)}`);
const total = { ok: results.filter((r) => r.ok).length, n: results.length };
console.log(`All: ${pct(total)}`);
fs.writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), base, total, by, byNoise, misses: results.filter((r) => !r.ok) }, null, 2));
console.log("Misses written to eval/results.json");
