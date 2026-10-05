import { callBack, CALLBACK_MS, openCall, respond, RING_MS, stillRelevant, textCopyFor, updateCall } from "../../src/lib/dispatch-calls";
import { generateWorld, PRIMARY_DRIVER_ID } from "../../src/lib/mock-data";
import { runDispatchCalls, type CallDraft } from "../../src/lib/store/calls";
import type { Lang, Load } from "../../src/lib/types";

let pass = 0;
let fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => {
  if (c) pass++;
  else fail++;
  console.log(c ? "PASS" : "FAIL", label, c ? "" : JSON.stringify(x)?.slice(0, 300));
};

const world = generateWorld();
const driver = world.drivers.find((d) => d.id === PRIMARY_DRIVER_ID)!;
const truck = world.trucks.find((t) => t.driverId === driver.id)!;
const load: Load = { ...world.loads[0], truckId: truck.id, stage: "booked", pickupWindow: "tomorrow, 8:00–11:00", lane: { ...world.loads[0].lane, origin: "Dallas", destination: "Memphis", miles: 452 } };
const LANGS: Lang[] = ["en", "es", "pa", "hi", "ru", "uk", "fr"];

// What the driver hears when plans change, in every language.
for (const what of ["booked", "cancelled", "replaced"] as const) {
  const replacement = { ...load, id: "rep-1", lane: { ...load.lane, origin: "Little Rock", destination: "Atlanta" } };
  for (const lang of LANGS) {
    const call = updateCall({ ...driver, prefs: { ...driver.prefs, language: lang } }, load, what, { replacement: what === "replaced" ? replacement : undefined, tonu: what === "cancelled" ? 250 : undefined });
    const open = openCall(call);
    const text = textCopyFor(call);
    const named = (s: string) => s.includes("Dallas") && s.includes("Memphis") && !s.includes("undefined") && !s.includes("NaN");
    ok(`${what} · ${lang}: says the load and has buttons`, named(open.say) && open.choices.length >= 1, open.say);
    ok(`${what} · ${lang}: text copy names it too`, named(text), text);
    if (what === "replaced") ok(`replaced · ${lang}: names the new load`, open.say.includes("Little Rock") && open.say.includes("Atlanta"), open.say);
    if (what === "cancelled") ok(`cancelled · ${lang}: the TONU is said`, open.say.includes("250"), open.say);
  }
}

const booked = updateCall(driver, load, "booked");
ok("booked: the driver can say it doesn't work", openCall(booked).choices.some((c) => c.reply === "nowork"));
const no = respond({ ...booked, status: "live", lines: [] }, "nowork");
ok("…which goes to a person at the office", !!no.report?.person && !!no.end, no);
ok("…and the call ends with what happened", /doesn't work/.test(no.outcome ?? ""), no.outcome);
ok("cancelled: just 'got it'", openCall(updateCall(driver, load, "cancelled")).choices.length === 1);
ok("a booked load that's gone isn't news anymore", !stillRelevant(booked, [{ ...load, stage: "declined" }]));
ok("a cancellation stays news", stillRelevant(updateCall(driver, load, "cancelled"), [{ ...load, stage: "cancelled" }]));

// Call backs.
const t0 = Date.now();
const back = callBack({ ...booked, status: "missed", textedAt: "x" }, t0);
ok("a call back is try 2, a few minutes later", back.attempt === 2 && Date.parse(back.notBefore!) === t0 + CALLBACK_MS && back.status === "queued");
ok("…and opens by owning it", /Me again/.test(openCall(back).say), openCall(back).say);
ok("…in the driver's language too", /otra vez/.test(openCall({ ...back, lang: "es" }).say));

const draftOf = (calls: CallDraft["dispatchCalls"], loads: Load[] = [load]): CallDraft => ({
  brokers: world.brokers, incidents: [], loads, trucks: world.trucks.map((t) => (t.id === truck.id ? { ...t, currentLoadId: null } : t)), drivers: world.drivers.map((d) => (d.id === driver.id ? { ...d, hosStatus: "driving", prefs: { ...d.prefs, noCallsBefore: undefined } } : d)),
  escalations: [], driverMessages: [], dispatchCalls: calls, events: [], readLang: "en", solo: false, live: false,
});

// Ringing too long: missed, texted, and a call back queued for later.
const ringing = { ...booked, status: "ringing" as const, ringingAt: new Date(Date.now() - RING_MS - 1000).toISOString() };
const d1 = draftOf([ringing]);
runDispatchCalls(d1, []);
const missed = d1.dispatchCalls.find((c) => c.id === ringing.id);
const queued = d1.dispatchCalls.find((c) => c.id !== ringing.id && c.kind === "update");
ok("missed: texted", missed?.status === "missed" && d1.driverMessages.length === 1, missed);
ok("…a call back is waiting", queued?.status === "queued" && queued.attempt === 2, queued);
ok("…and it doesn't ring before its time", d1.dispatchCalls.every((c) => c.status !== "ringing"));
ok("…the owner sees it", d1.events.some((e) => /calling back/.test(e.detail ?? "")), d1.events);

const d2 = draftOf([{ ...queued!, notBefore: new Date(Date.now() - 1000).toISOString() }]);
runDispatchCalls(d2, []);
ok("when its time comes it rings", d2.dispatchCalls[0].status === "ringing", d2.dispatchCalls[0].status);

const third = { ...booked, attempt: 3, status: "ringing" as const, ringingAt: new Date(Date.now() - RING_MS - 1000).toISOString() };
const d3 = draftOf([third]);
runDispatchCalls(d3, []);
ok("after the third try it stops calling", d3.dispatchCalls.length === 1 && d3.dispatchCalls[0].status === "missed");

// A load booked for the driver by someone else: dispatch calls about it, once.
const d4 = draftOf([], [{ ...load, pickedBy: "carrier" }]);
runDispatchCalls(d4, []);
ok("booked by the owner: the driver gets a call", d4.dispatchCalls.some((c) => c.kind === "update" && c.facts.what === "booked" && c.loadId === load.id));
runDispatchCalls(d4, []);
ok("…only one", d4.dispatchCalls.filter((c) => c.kind === "update").length === 1);
const d5 = draftOf([], [{ ...load, pickedBy: "driver" }]);
runDispatchCalls(d5, []);
ok("picked by the driver: no call about it", !d5.dispatchCalls.some((c) => c.kind === "update"));
const d6 = draftOf([], [{ ...load, pickedBy: "ai", stage: "negotiating" }]);
runDispatchCalls(d6, []);
ok("not until the broker confirms", !d6.dispatchCalls.some((c) => c.kind === "update"));

console.log(`${pass} passed, ${fail} failed`);
