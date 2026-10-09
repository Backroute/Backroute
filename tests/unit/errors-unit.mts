// Grouping the app's errors (lib/error-log): the same error on different loads or users is one kind, counted.
import { errorKind, fingerprint, pathKind } from "../../src/lib/error-log";

let passed = 0,
  failed = 0;
const check = (label: string, ok: boolean, extra = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra && !ok ? ` (${extra})` : ""}`);
};

check("ids and numbers in a message don't make it a new kind", errorKind("Load load-mv13c2 not found for 6f1c2a1e-1b2c-4d5e-8f90-0a1b2c3d4e5f at 12:30") === errorKind("Load load-zz99k1 not found for 0a1b2c3d-1b2c-4d5e-8f90-6f1c2a1e4e5f at 09:05"), errorKind("Load load-mv13c2 not found for 6f1c2a1e-1b2c-4d5e-8f90-0a1b2c3d4e5f at 12:30"));
check("…a different message is", errorKind("Cannot read properties of undefined (reading 'lane')") !== errorKind("Cannot read properties of undefined (reading 'truck')"));
check("…and only the first line counts (stacks differ by build)", errorKind("boom\n    at a (x.js:1:2)") === errorKind("boom\n    at b (y.js:9:9)"));
check("pages with an id in the path are one page, and the query is dropped", pathKind("/carrier/loads/load-mv13c2yoy2t5?tab=docs&token=secret") === pathKind("/carrier/loads/load-ab12cd34ef56") && !pathKind("/x?token=secret").includes("secret"), pathKind("/carrier/loads/load-mv13c2yoy2t5?tab=docs"));
check("…and short words stay", pathKind("/carrier/settings") === "/carrier/settings");
const a = fingerprint({ source: "server", message: "boom 1", path: "/api/a" }, "2026-10-09");
check("one kind on one day has one fingerprint", a === fingerprint({ source: "server", message: "boom 2", path: "/api/a?x=1" }, "2026-10-09") && a.startsWith("2026-10-09:"));
check("…a new one each day, and server and browser kept apart", a !== fingerprint({ source: "server", message: "boom 1", path: "/api/a" }, "2026-10-10") && a !== fingerprint({ source: "browser", message: "boom 1", path: "/api/a" }, "2026-10-09"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
