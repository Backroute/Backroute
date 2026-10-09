// The rounds' pool (lib/agent/rounds-order): a few carriers at a time, none started past the budget, one failing
// carrier not stopping the rest.
import { inPool } from "../../src/lib/agent/rounds-order";

let passed = 0,
  failed = 0;
const check = (label: string, ok: boolean, extra = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra && !ok ? ` (${extra})` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);

{
  let running = 0,
    most = 0;
  const seen: string[] = [];
  const t = Date.now();
  const skipped = await inPool(ids, 5, Date.now() + 60_000, async (id) => {
    running++;
    most = Math.max(most, running);
    await sleep(40);
    seen.push(id);
    running--;
  });
  check("every carrier gets its round", skipped === 0 && seen.length === 20 && new Set(seen).size === 20, `${skipped} ${seen.length}`);
  check("at most five at once", most === 5, String(most));
  check("in parallel: about a quarter of the time one at a time would take", Date.now() - t < 20 * 40 * 0.5, `${Date.now() - t}ms`);
}
{
  const seen: string[] = [];
  const skipped = await inPool(ids, 2, Date.now() + 100, async (id) => {
    await sleep(60);
    seen.push(id);
  });
  check("past the budget no new carrier starts, and the rest are counted", skipped > 0 && seen.length + skipped === 20 && seen.length <= 6, `${seen.length} done, ${skipped} left`);
  check("the ones left are the end of the list (the longest-served go first next time)", seen.every((id) => ids.indexOf(id) < seen.length), seen.join(","));
}
{
  const seen: string[] = [];
  const err = console.error;
  console.error = () => {};
  await inPool(["a", "b", "c"], 1, Date.now() + 10_000, async (id) => {
    if (id === "b") throw new Error("boom");
    seen.push(id);
  });
  console.error = err;
  check("a carrier whose round fails doesn't stop the others", seen.join(",") === "a,c", seen.join(","));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
