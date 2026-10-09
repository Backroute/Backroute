// The owner-URL guard (lib/owner-url) and the constant-time bearer check (lib/bearer).
import http from "node:http";
import { checkOwnerUrl, fetchOwnerUrl, privateAddress, UnsafeUrl } from "../../src/lib/owner-url";
import { hasBearer } from "../../src/lib/bearer";

let passed = 0,
  failed = 0;
const check = (label: string, ok: boolean, extra = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra && !ok ? ` (${extra})` : ""}`);
};
const refused = async (u: string) => {
  try {
    await checkOwnerUrl(u, true);
    return "";
  } catch (e) {
    return e instanceof UnsafeUrl ? e.message : `other: ${e}`;
  }
};

const inside = ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.9", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"];
const outside = ["8.8.8.8", "52.1.2.3", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"];
check("this machine, private networks, link-local and multicast are inside", inside.every(privateAddress), inside.filter((x) => !privateAddress(x)).join(","));
check("public addresses are outside", !outside.some(privateAddress), outside.filter(privateAddress).join(","));

check("production: plain http is refused", /https/.test(await refused("http://feeds.example.com/loads.json")));
check("production: localhost is refused", /public internet/.test(await refused("https://localhost:3009/feed")));
check("production: cloud metadata by address is refused", /public internet/.test(await refused("https://169.254.169.254/latest/meta-data")));
check("production: a private address is refused", /public internet/.test(await refused("https://10.0.0.5/feed")));
check("production: an IPv6 loopback is refused", /public internet/.test(await refused("https://[::1]/feed")));
check("production: an .internal name is refused", /public internet/.test(await refused("https://db.internal/feed")));
check("not a web address is refused", /web address/.test(await refused("not a url")));
check("outside production the test stand-ins are allowed", (await checkOwnerUrl("http://localhost:3009/feed", false)).host === "localhost:3009");

// Redirects are followed (a 303 after a POST goes on as a GET), and a loop stops.
const server = http.createServer((req, res) => {
  if (req.url === "/start") return res.writeHead(303, { location: "/end" }).end();
  if (req.url === "/end") return res.writeHead(200, { "content-type": "text/plain" }).end(`got ${req.method}`);
  if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
  res.writeHead(404).end();
});
await new Promise<void>((r) => server.listen(3032, r));
const r = await fetchOwnerUrl("http://localhost:3032/start", { method: "POST", body: "x" }, false);
check("a redirect is followed, a 303 after a POST as a GET", (await r.text()) === "got GET");
let loop = "";
try {
  await fetchOwnerUrl("http://localhost:3032/loop", {}, false);
} catch (e) {
  loop = e instanceof UnsafeUrl ? e.message : String(e);
}
check("a redirect loop stops", /Too many redirects/.test(loop), loop);
server.close();

const req = (h?: string) => new Request("http://x/api/cron/dispatch", { headers: h ? { authorization: h } : {} });
check("the right bearer secret passes", hasBearer(req("Bearer s3cret-value"), "s3cret-value"));
check("a wrong or missing one doesn't", !hasBearer(req("Bearer s3cret-valuX"), "s3cret-value") && !hasBearer(req(), "s3cret-value") && !hasBearer(req("s3cret-value"), "s3cret-value"));
check("with no secret set nothing passes, not even an empty bearer", !hasBearer(req("Bearer "), undefined) && !hasBearer(req("Bearer "), ""));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
