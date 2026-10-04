import { dollarAmounts, spokenEmail, onlyKnownPrices } from "../../src/lib/agent/pricing";
const cases: [string, number[]][] = [
  ["We can do $2,450 all in", [2450]], ["$ 75 lumper", [75]], ["$2450.00", [2450]], ["$2.4k works", [2400]], ["2,450 dollars", [2450]],
  ["2450 bucks", [2450]], ["USD 2450", [2450]], ["53 foot trailer, 780 miles", []], ["$2.80 a mile", [2]], ["2.5k dollars", [2500]], ["1800 USD", [1800]],
];
let bad = 0;
for (const [t, want] of cases) { const got = dollarAmounts(t); const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(ok ? "ok " : "BAD", t, "→", got); }
for (const [t, want] of [["kim at tql dot com", "kim@tql.com"], ["Kim underscore B at T Q L dot com.", "kim_b@tql.com"], ["dispatch dash one at acme freight dot test", "dispatch-one@acmefreight.test"]]) { const got = spokenEmail(t); if (got !== want) bad++; console.log(got === want ? "ok " : "BAD", t, "→", got); }
console.log("AI reply naming 2,300 dollars when only 2,450 known is caught:", !onlyKnownPrices("we can do 2,300 dollars", [2450]));
console.log(bad ? `${bad} BAD` : "all ok");
