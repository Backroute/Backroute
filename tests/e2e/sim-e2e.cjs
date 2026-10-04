// The simulated week (eval/sim.mjs), scripted against the stand-ins: every scenario runs, no hard rule breaks, and the
// money captured stays at 90% or more of what the brokers would really pay.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const { execSync } = require("child_process");
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 400)})` : ""}`); };
let out = "";
try {
  out = execSync("node eval/sim.mjs --base http://localhost:3210 --scripted --concurrency 3", { cwd: ROOT, env: { ...process.env, EVAL_SECRET: "eval-secret" }, timeout: 900000 }).toString();
} catch (e) {
  out = (e.stdout ?? "").toString() + (e.stderr ?? "").toString();
}
const lines = out.split("\n");
const results = lines.filter((l) => /^(OK|WARN|FAIL|ERR) /.test(l));
check("every scenario ran", results.length === 14 && !results.some((l) => l.startsWith("ERR")), results.filter((l) => !l.startsWith("OK")).join(" | "));
check("no hard rule broken (never under the lowest, never under the broker's offer, nothing to an impostor, nothing internal said)", /no hard rule broken/.test(out) && !results.some((l) => l.startsWith("FAIL")), lines.filter((l) => /✗/.test(l)).join(" | "));
const pct = Number(out.match(/(\d+)% of what brokers would really pay/)?.[1] ?? 0);
check("money: at least 90% of what brokers would really pay, across the week's deals", pct >= 90, lines.at(-2));
check("the impostor gets nothing and a person is asked", /OK {3}fake-broker: Didn't reply; flagged for a person\./.test(out));
check("the phone menu: key pressed, quiet on hold, booked", /OK {3}phone-menu: Booked/.test(out));
check("the walk-away load isn't taken under the lowest", /OK {3}walk-away: No deal/.test(out));
console.log(out.split("\n").slice(-3).join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
