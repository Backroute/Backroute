// public/sw.js run in Node with a stand-in cache and network: the trip's map area is saved, then served with no signal.
const fs = require("fs");
const vm = require("vm");
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 200)})` : ""}`); };

const stores = new Map();
const cacheOf = (name) => {
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  const key = (r) => (typeof r === "string" ? r : r.url);
  return {
    match: async (r) => (m.has(key(r)) ? m.get(key(r)).clone() : undefined),
    put: async (r, res) => void m.set(key(r), res),
    keys: async () => [...m.keys()].map((u) => new Request(u)),
    delete: async (r) => m.delete(key(r)),
    add: async () => {},
  };
};
let online = true;
const fetched = [];
const net = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  if (!online) throw new TypeError("Failed to fetch");
  fetched.push(url);
  const u = new URL(url);
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  if (u.pathname === "/styles/dark") return json({ version: 8, sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } }, sprite: "https://tiles.openfreemap.org/sprites/ofm", glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", layers: [] });
  if (u.pathname === "/planet") return json({ tilejson: "3.0.0", tiles: ["https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf"], maxzoom: 14 });
  return new Response("tile:" + u.pathname, { status: 200 });
};
const handlers = {};
const self = {
  location: { href: "https://app.test/sw.js?offline=1", origin: "https://app.test" },
  addEventListener: (t, f) => (handlers[t] = f),
  skipWaiting: () => {},
  clients: { claim: async () => {}, matchAll: async () => [] },
  registration: { showNotification: async () => {} },
};
const ctx = vm.createContext({ self, caches: { open: async (n) => cacheOf(n), keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) }, fetch: net, Request, Response, URL, URLSearchParams, console, setTimeout, Promise, Buffer, indexedDB: undefined });
vm.runInContext(fs.readFileSync(require("path").join(__dirname, "../../public/sw.js"), "utf8"), ctx);

(async () => {
  // Dallas to Waco, as the trip map would send it.
  const waits = [];
  handlers.message({ data: { type: "keep-trip-map", style: "https://tiles.openfreemap.org/styles/dark", points: [[32.7767, -96.797], [32.1, -96.9], [31.5493, -97.1467]] }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const map = stores.get("backroute-map-v1") ?? new Map();
  const tiles = [...map.keys()].filter((u) => /\/planet\/v1\//.test(u));
  const zooms = new Set(tiles.map((u) => Number(u.split("/").at(-3))));
  check("the trip's map area is saved: whole trip down to town level at each end", tiles.length >= 40 && [4, 5, 6, 7, 8, 10, 11].every((z) => zooms.has(z)) && !zooms.has(12), `${tiles.length} tiles, zooms ${[...zooms].sort((a, b) => a - b)}`);
  check("...a few hundred pieces at most", tiles.length <= 400, tiles.length);
  check("...with the style, the tile list, the icons and the road-name fonts", map.has("https://tiles.openfreemap.org/styles/dark") && map.has("https://tiles.openfreemap.org/planet") && [...map.keys()].some((u) => /sprites\/ofm\.png$/.test(u)) && [...map.keys()].some((u) => /fonts\/Noto%20Sans%20Regular\/0-255\.pbf$/.test(u)));
  const before = fetched.length;
  const again = [];
  handlers.message({ data: { type: "keep-trip-map", style: "https://tiles.openfreemap.org/styles/dark", points: [[32.7767, -96.797], [31.5493, -97.1467]] }, waitUntil: (p) => again.push(p) });
  await Promise.all(again);
  check("opening the same trip again downloads only the style and tile list, not the tiles", fetched.slice(before).filter((u) => /\/planet\/v1\//.test(u)).length === 0, fetched.slice(before).length);
  // No signal: the map asks for a saved piece and for the style.
  online = false;
  const serve = async (url) => {
    let res;
    handlers.fetch({ request: new Request(url), respondWith: (p) => (res = p) });
    return res ? await res : null;
  };
  const tile = await serve(tiles[0]);
  check("no signal: a saved map piece comes from the phone", !!tile && tile.status === 200 && (await tile.text()).startsWith("tile:"));
  const style = await serve("https://tiles.openfreemap.org/styles/dark");
  check("...and the style too (fresh online, saved copy offline)", !!style && style.status === 200);
  const missing = await serve("https://tiles.openfreemap.org/planet/v1/14/1/1.pbf").catch(() => null);
  check("a piece never saved fails cleanly offline", !missing || missing.type === "error" || missing.status !== 200);
  // Other sites aren't touched.
  let touched = false;
  handlers.fetch({ request: new Request("https://example.com/x"), respondWith: () => (touched = true) });
  check("requests to other sites pass straight through", !touched);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
