import { hosNow, clockWords, warningDue, warningWords, whereHoursEnd, samplePoints } from "../../src/lib/hos-clock.ts";
import { otsu, paperBox } from "../../src/lib/doc-scan.ts";
import { NAV_APPS, navApp, profileWords, DEFAULT_PROFILE } from "../../src/lib/nav-apps.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label); } };
const now = Date.parse("2026-10-02T15:00:00Z");

const eld = { hosStatus: "driving", hoursRemaining: 5, hos: { drive: 2, shift: 6, cycle: 30, at: new Date(now - 30 * 60_000).toISOString(), source: "samsara" } } as any;
const h = hosNow(eld, now);
ok("drive and shift tick down while driving", Math.abs(h.drive - 1.5) < 0.01 && Math.abs(h.shift - 5.5) < 0.01 && h.cycle! < 30 && h.fromEld);
const off = hosNow({ ...eld, hosStatus: "off_duty" }, now);
ok("off duty: clocks hold", off.drive === 2 && off.shift === 6);
ok("no ELD: hours from the app", hosNow({ hosStatus: "on_duty", hoursRemaining: 4 } as any, now).drive === 4);
ok("clock words", clockWords(1.5) === "1:30" && clockWords(0.05) === "0:03");
ok("warnings at 60/30/15", warningDue({ ...h, drive: 0.9 }) === 60 && warningDue({ ...h, drive: 0.45 }) === 30 && warningDue({ ...h, drive: 0.2 }) === 15 && warningDue({ ...h, drive: 2 }) === null);
ok("the shift is named when it runs out first", /your shift/.test(warningWords(30, { ...h, drive: 3, shift: 0.5 })));
const from: [number, number] = [32.78, -96.8];
const to: [number, number] = [39.77, -86.16];
const e = whereHoursEnd(from, to, 0, 4);
ok("hours run out partway: 200 miles at 50 mph", !e.reachesStop && e.miles === 200 && e.at[0] > from[0] && e.at[0] < to[0]);
ok("plenty of hours: makes the stop", whereHoursEnd(from, to, 0.9, 10).reachesStop);
const pts = samplePoints(from, to, 0);
ok("weather points every ~100 miles, at most 6, start to end", pts.length === 6 && pts[0][0] === 32.78 && pts[5][0] === 39.77);

// Paper detection: a bright sheet in the middle of a dark frame.
const w = 100, hgt = 140;
const img = new Array(w * hgt).fill(40);
for (let y = 30; y < 120; y++) for (let x = 20; x < 85; x++) img[y * w + x] = 230;
const box = paperBox(img, w, hgt);
ok("finds the sheet", !!box && Math.abs(box[0] - 0.2) < 0.02 && Math.abs(box[1] - 30 / 140) < 0.02 && Math.abs(box[2] - 0.85) < 0.02 && Math.abs(box[3] - 120 / 140) < 0.02);
ok("a photo that's all paper isn't cropped", paperBox(new Array(w * hgt).fill(230), w, hgt) === null);
const hist = new Array(256).fill(0); hist[40] = 500; hist[230] = 500;
const t = otsu(hist, 1000);
ok("otsu splits dark from bright", t >= 40 && t < 230);

// Nav apps
const at: [number, number] = [39.7684, -86.1581];
ok("Sygic takes longitude first", navApp("sygic").link({ at, label: "x" }) === "com.sygic.aura://coordinate|-86.1581|39.7684|drive");
ok("only truck GPS apps: no Google, Apple or Waze", NAV_APPS.map((a) => a.id).join() === "sygic,copilot" && NAV_APPS.every((a) => !/google|apple|waze/i.test(a.link({ at, label: "x" }))));
ok("a saved car app falls back to a truck app", navApp("google" as never).id === "sygic" && navApp(undefined).id === "sygic");
ok("CoPilot gets the exact spot", navApp("copilot").link({ at, label: "Dock 4" }).includes("lat=39.7684&long=-86.1581"));
ok("each app has a store link", NAV_APPS.every((a) => a.store.android.startsWith("https://play.google.com/store/search") && a.store.ios.startsWith("itms-apps://")));
ok("profile words", profileWords(DEFAULT_PROFILE) === `13'6" tall · 80,000 lbs · 70 ft`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
