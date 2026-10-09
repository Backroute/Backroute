// Prints the pilot kit for one carrier: the owner's one-page guide, the driver sheet with cut-out cab cards (English and
// Spanish), and the drivers' consent form (marked DRAFT until a lawyer approves the wording). From docs/pilot-kit.
//
//   node scripts/pilot-kit.mjs --carrier "Lone Star Hauling" --dispatch "(469) 555-0199" \
//        [--inbound "abc123+k7f2@inbound.postmarkapp.com"] [--support "(214) 555-0123"] [--site https://backroute.pro] \
//        [--out pilot-kit]
//
// Anything left out prints as a blank line to write in by hand. Writes the filled-in pages as HTML, and as PDFs when
// Playwright can be loaded (it's in the test setup; otherwise open the HTML in a browser and print to PDF).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rest = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc), []));
if (args.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}

const BLANK = "__________________";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const values = {
  carrier: args.carrier ? esc(args.carrier) : BLANK,
  dispatch: args.dispatch ? esc(args.dispatch) : BLANK,
  inbound: args.inbound ? esc(args.inbound) : BLANK,
  support: args.support ? esc(args.support) : BLANK,
  site: esc((args.site ?? "https://backroute.pro").replace(/^https?:\/\//, "").replace(/\/$/, "")),
};

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../docs/pilot-kit");
const OUT = path.resolve(args.out ?? "pilot-kit");
fs.mkdirSync(OUT, { recursive: true });
const PAGES = ["carrier-guide", "driver-card", "driver-consent-form"];

const written = [];
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(SRC, `${page}.html`), "utf8").replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m);
  const file = path.join(OUT, `${page}.html`);
  fs.writeFileSync(file, html);
  written.push(file);
}

// Playwright from this project, or the one installed globally (the test setup's).
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    try {
      const root = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      return createRequire(path.join(root, "noop.js"))("playwright");
    } catch {
      return null;
    }
  }
}

const pw = await loadPlaywright();
if (!pw) {
  console.log(`Wrote ${written.length} pages to ${OUT}. Playwright isn't installed, so open each in a browser and print to PDF (Letter, no margins added).`);
  process.exit(0);
}
const proxy = process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1"] : [];
const exe = process.env.CHROMIUM_PATH ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await pw.chromium.launch({ executablePath: exe, args: proxy });
const tab = await browser.newPage();
for (const file of written) {
  await tab.goto(`file://${file}`, { waitUntil: "networkidle" }).catch(() => tab.goto(`file://${file}`));
  await tab.evaluate(() => document.fonts.ready);
  const pdf = file.replace(/\.html$/, ".pdf");
  await tab.pdf({ path: pdf, format: "Letter", preferCSSPageSize: true, printBackground: true });
  const pages = (fs.readFileSync(pdf, "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  console.log(`${path.relative(process.cwd(), pdf)}  (${pages} page${pages === 1 ? "" : "s"})`);
}
await browser.close();
if (!args.carrier) console.log("No --carrier given: the pages have blanks to fill in by hand.");
