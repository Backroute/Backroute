import { computeDriverPay } from "./settlements";
import { legMiles } from "./trip-geo";
import { pack, type CallPack, type PrefKey } from "./lang";
import type {
  DispatchCall,
  DispatchCallChoice,
  DispatchCallEffect,
  DispatchCallKind,
  DispatchCallOption,
  DispatchCallReport,
  Driver,
  DriverPrefs,
  Lang,
  Load,
} from "./types";

/**
 * The calls a human dispatcher makes all day, scripted: a load to offer, the pickup number before the gate, the
 * receiver's rules before delivery, a late appointment already fixed, and where to park when hours run out. Every
 * call is short, says numbers in groups the way people read them over the phone, and ends with a text copy so the
 * driver never writes anything down while driving.
 *
 * A call keeps facts, not sentences: the words come from the driver's language pack when they're spoken, so the same
 * call can be said in Spanish to the driver and shown in English (or Punjabi) to the owner. Each turn is decided
 * here; the store only applies the result.
 */

/** Carrier-facing names for each kind of call. The carrier dashboard is English in the demo. */
export const KIND_LABEL: Record<DispatchCallKind, string> = {
  next_load: "Next load",
  pickup_brief: "Before pickup",
  delivery_brief: "Before delivery",
  late_eta: "Running late",
  hours_parking: "Hours and parking",
  setup: "Call setup",
  inbound: "Driver called in",
};

/** The carrier's number the AI answers and calls from. Demo: not connected to a phone provider. */
export const DISPATCH_LINE = "(469) 555-0199";
/** Who "someone from the office" is when the owner joins a call. */
export const OWNER_NAME = "Alicia";

/** How long the phone rings before it counts as missed and the AI texts instead. */
export const RING_MS = 25_000;
/** Space between two calls to the same driver, so the phone isn't ringing back to back. */
export const CALL_GAP_MS = 20_000;

const SHIPPERS = ["Great Plains Foods", "Lone Star Packaging", "Midway Paper Co.", "Summit Beverage", "Keystone Building Supply", "Harbor Cold Storage", "Redline Auto Parts", "Prairie Grain Mills"];
const RECEIVERS = ["Walmart DC 6012", "Kroger DC", "Home Depot RDC", "Target DC 3807", "Sysco", "H-E-B Warehouse", "Costco Depot", "Lowe's RDC"];
const ROADS = ["I-40", "I-35", "I-20", "I-30", "I-45", "I-10", "I-44"];
const STOPS = ["TA", "Pilot", "Love's", "Petro"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const from = <T,>(arr: T[], seed: number) => arr[seed % arr.length];

/** "482719" → "4 8 2, 7 1 9": the way a dispatcher reads a number so it sticks. Digits are read in any language. */
export function sayDigits(n: string): string {
  const groups = n.match(/.{1,3}/g) ?? [n];
  return groups.map((g) => g.split("").join(" ")).join(", ");
}

const firstName = (d: Driver) => d.name.split(" ")[0];
export const driverLang = (d: Driver | undefined): Lang => d?.prefs?.language ?? "en";

/** Whether the AI would drop this load into the driver's lap right now. */
export function driverTakes(prefs: DriverPrefs | undefined, load: Pick<Load, "lane">): boolean {
  const avoid = prefs?.avoidStates ?? [];
  return !avoid.includes(load.lane.destState) && !avoid.includes(load.lane.originState);
}

/** About three loads in ten hit something on the way that moves the appointment. Decided per load, so it's stable. */
export function lateOnThisLoad(loadId: string): boolean {
  return hash(loadId + "late") % 10 < 3;
}

export type QuietState = { kind: "sleeper" | "off_duty" } | { kind: "early"; hour: number } | null;

/** Why a call can't ring right now, or null when it can. Sleeper and off duty are never interrupted. */
export function quietState(driver: Driver, now: Date): QuietState {
  if (driver.hosStatus === "sleeper") return { kind: "sleeper" };
  if (driver.hosStatus === "off_duty") return { kind: "off_duty" };
  const before = driver.prefs?.noCallsBefore;
  if (before !== undefined && now.getHours() < before) return { kind: "early", hour: before };
  return null;
}

/** The same, in words for the carrier's board. */
export function quietReason(driver: Driver, now: Date): string | null {
  const q = quietState(driver, now);
  if (!q) return null;
  if (q.kind === "early") return `No calls before ${pack("en").hour(q.hour)}`;
  return q.kind === "sleeper" ? `${firstName(driver)}'s in the sleeper` : `${firstName(driver)}'s off duty`;
}

interface NewCall {
  kind: DispatchCallKind;
  driver: Driver;
  load?: Load;
  facts?: Record<string, string>;
  options?: DispatchCallOption[];
}

export function newDispatchCall({ kind, driver, load, facts = {}, options }: NewCall): DispatchCall {
  return {
    id: `dcall-${Math.random().toString(36).slice(2, 10)}`,
    driverId: driver.id,
    carrierId: driver.carrierId,
    loadId: load?.id,
    kind,
    lang: driverLang(driver),
    status: "queued",
    createdAt: new Date().toISOString(),
    lines: [],
    choices: [],
    step: "start",
    facts: { name: firstName(driver), ...facts },
    options,
    effects: [],
  };
}

// ——— Facts gathered when the AI decides to call ———

export interface EmptyAt {
  kind: "after" | "in";
  city: string;
}

/** A load as the AI reads it out: in the driver's own money (what they make, not what the truck grosses). */
function optionFor(l: Load, driver: Driver, team: boolean): DispatchCallOption {
  const local = driver.runType === "local" || driver.runType === "intown";
  const home: DispatchCallOption["home"] =
    l.hoursHomeAfter === undefined
      ? undefined
      : local
        ? { kind: l.homeTonight ? "tonight" : "late" }
        : l.hoursHomeAfter < 1
          ? { kind: "near" }
          : { kind: "hours", hours: Math.round(l.hoursHomeAfter) };
  return {
    loadId: l.id,
    short: `${l.lane.origin} → ${l.lane.destination}, $${(l.bookedRate ?? l.targetRate).toLocaleString()}`,
    origin: l.lane.origin,
    dest: l.lane.destination,
    miles: l.lane.miles,
    day: /^tomorrow/i.test(l.pickupWindow) ? "tomorrow" : "today",
    pay: Math.round(computeDriverPay(l, driver, team) / 5) * 5,
    move: !!l.lane.moveKind,
    home,
  };
}

/** The next-load call reads the options best-first. */
export function nextLoadCall(driver: Driver, offers: Load[], emptyAt: EmptyAt, team: boolean): DispatchCall | null {
  const ranked = [...offers].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || b.score - a.score).slice(0, 3);
  if (!ranked.length || !ranked[0].offerGroupId) return null;
  return newDispatchCall({
    kind: "next_load",
    driver,
    load: ranked[0],
    options: ranked.map((l) => optionFor(l, driver, team)),
    facts: { groupId: ranked[0].offerGroupId, emptyKind: emptyAt.kind, emptyCity: emptyAt.city, count: String(offers.length) },
  });
}

/** The appointment as the load carries it, turned into facts any language can say. Loads without a set time get
 *  the receiver's usual one. */
function apptFacts(window: string, h: number): Record<string, string> {
  const to24 = (hr: string, ap: string) => String((Number(hr) % 12) + (ap === "PM" ? 12 : 0));
  const moved = window.match(/Moved to (\d+) ([AP]M)/);
  if (moved) return { apptKind: "at", apptA: to24(moved[1], moved[2]) };
  const slot = window.match(/appointment (\d+):00 ([AP]M)/);
  if (slot) return { apptKind: "at", apptA: to24(slot[1], slot[2]) };
  if (/^Tomorrow, 7 AM/.test(window)) return { apptKind: "tomorrow7" };
  const range = window.match(/(\d+):00–(\d+):00/);
  if (range) return { apptKind: "window", apptA: range[1], apptB: range[2] };
  return { apptKind: "at", apptA: String(8 + (h % 8)) };
}

export function briefCall(driver: Driver, load: Load, stop: "pickup" | "delivery", legP: number): DispatchCall {
  const h = hash(load.id + stop);
  const container = load.lane.moveKind === "container_pickup" || load.lane.moveKind === "empty_return";
  const milesLeft = Math.max(4, Math.round(legMiles(load, stop) * (1 - legP)));
  return newDispatchCall({
    kind: stop === "pickup" ? "pickup_brief" : "delivery_brief",
    driver,
    load,
    facts: {
      place: stop === "pickup" ? from(SHIPPERS, h) : from(RECEIVERS, h),
      city: stop === "pickup" ? load.lane.origin : load.lane.destination,
      number: String(100000 + (h % 900000)),
      numberKind: container ? "container" : stop,
      prefix: container ? from(["MSCU", "MAEU", "CMAU", "HLXU"], h) : "",
      etaMin: String(Math.round((milesLeft / 50) * 60)),
      note: String((h >>> 3) % 4),
      lumper: String(150 + (h % 4) * 25),
      ...apptFacts(stop === "pickup" ? load.pickupWindow : load.deliveryWindow, h),
    },
  });
}

/** The AI has already fixed the appointment; the call just makes sure the driver knows. */
export function lateCall(driver: Driver, load: Load): { call: DispatchCall; newWindow: string } {
  const h = hash(load.id + "late");
  const delay = 30 + (h % 4) * 15;
  const appt = 9 + (h % 8);
  const moved = appt + Math.ceil(delay / 60);
  const en = pack("en");
  return {
    newWindow: `Moved to ${en.hour(moved)} (was ${en.hour(appt)})`,
    call: newDispatchCall({
      kind: "late_eta",
      driver,
      load,
      facts: { road: from(ROADS, h), delay: String(delay), was: String(appt), now: String(moved), city: load.lane.destination },
    }),
  };
}

/** Out of hours before the receiver: a parking spot ahead and a delivery moved to the morning. */
export function parkingCall(driver: Driver, load: Load, milesLeft: number): { call: DispatchCall; newWindow: string } {
  const h = hash(load.id + "park");
  const hoursLeft = driver.hoursRemaining;
  return {
    newWindow: "Tomorrow, 7 AM (moved, out of hours)",
    call: newDispatchCall({
      kind: "hours_parking",
      driver,
      load,
      facts: {
        hours: String(hoursLeft < 1 ? 0 : Math.round(hoursLeft)),
        miles: String(Math.round(milesLeft)),
        brand: from(STOPS, h),
        exit: String(40 + (h % 300)),
        ahead: String(Math.max(20, Math.round(hoursLeft * 50 * 0.85))),
        cost: String(15 + (h % 3) * 5),
      },
    }),
  };
}

/** The driver calls dispatch. The AI already knows what they'll likely ask about: their next load, their pay this week. */
export function inboundCall(
  driver: Driver,
  ctx: { weekPay: number; weekLoads: number; nextBooked?: Load; offers: Load[]; emptyAt: EmptyAt; team: boolean },
): DispatchCall {
  const offer = ctx.offers.length ? nextLoadCall(driver, ctx.offers, ctx.emptyAt, ctx.team) : null;
  const booked = ctx.nextBooked;
  return newDispatchCall({
    kind: "inbound",
    driver,
    options: offer?.options,
    facts: {
      ...(offer ? { groupId: offer.facts.groupId, count: offer.facts.count, emptyKind: ctx.emptyAt.kind, emptyCity: ctx.emptyAt.city } : {}),
      ...(booked
        ? {
            bookedOrigin: booked.lane.origin,
            bookedDest: booked.lane.destination,
            bookedMiles: String(booked.lane.miles),
            bookedDay: /^tomorrow/i.test(booked.pickupWindow) ? "tomorrow" : "today",
          }
        : {}),
      weekPay: String(Math.round(ctx.weekPay)),
      weekLoads: String(ctx.weekLoads),
    },
  });
}

export function setupCall(driver: Driver): DispatchCall {
  return newDispatchCall({ kind: "setup", driver });
}

// ——— Putting facts into words ———

const money = (n: string | number) => `$${Number(n).toLocaleString()}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function emptyAtWords(L: CallPack, f: Record<string, string>): string {
  return L.emptyAt(f.emptyKind === "in" ? "in" : "after", f.emptyCity ?? "");
}

function numberLine(L: CallPack, f: Record<string, string>): string {
  const spoken = f.prefix ? `${f.prefix.split("").join(" ")}, ${sayDigits(f.number)}` : sayDigits(f.number);
  return L.numberLine(L.numberKind[f.numberKind as "pickup" | "delivery" | "container"] ?? L.numberKind.pickup, spoken);
}

function apptWords(L: CallPack, f: Record<string, string>): string {
  if (f.apptKind === "tomorrow7") return L.apptTomorrow7;
  if (f.apptKind === "window") return L.apptWindow(L.hour(Number(f.apptA)), L.hour(Number(f.apptB)));
  return L.apptAt(L.hour(Number(f.apptA)));
}

function noteWords(L: CallPack, call: DispatchCall): string {
  const notes = call.kind === "pickup_brief" ? L.pickupNotes : L.deliveryNotes;
  return notes[Number(call.facts.note) % notes.length];
}

function stopWords(L: CallPack, f: Record<string, string>): string {
  return L.stop(f.brand, Number(f.exit));
}

// ——— The conversation ———

export interface Turn {
  say: string;
  choices: DispatchCallChoice[];
  step: string;
  /** Replaces the call's effects when set. */
  effects?: DispatchCallEffect[];
  end?: boolean;
  /** Carrier-facing, in English. */
  outcome?: string;
  /** Something the store starts on right away: an incident, or a person at the carrier. */
  report?: DispatchCallReport;
  /** Facts learned on the call, merged into the call's own. */
  facts?: Record<string, string>;
}

/** A choice on screen. `match` holds English voice words; other languages match by the label, a number or a keyword. */
const c = (label: string, reply: string, match?: string): DispatchCallChoice => ({ label, reply, say: label, match });

function offerChoices(L: CallPack, i: number, call: DispatchCall): DispatchCallChoice[] {
  const more = (call.options?.length ?? 0) > i + 1;
  return [
    c(i === 0 ? L.ch.bookIt : L.ch.bookThis, `book:${i}`, "book|yes|yeah|take it|sure|sounds good"),
    ...(more ? [c(L.ch.whatElse, `next:${i + 1}`, "else|other|next|another")] : i > 0 ? [c(L.ch.bookFirst, "book:0", "first")] : []),
    c(L.ch.notNow, "later", "not now|later|no|pass|nah"),
  ];
}

const INBOUND_MENU = (L: CallPack): DispatchCallChoice[] => [
  c(L.ch.myNext, "next_q", "next|load|where am i going"),
  c(L.ch.brokeDown, "breakdown", "broke|breakdown|won't start|flat|tire|engine|smoke"),
  c(L.ch.runningLate, "late", "late|traffic|behind|delay"),
  c(L.ch.myPay, "pay", "pay|check|money|settlement|paid"),
];

/** What the AI says when the driver picks up, in `lang` (the driver's, unless it's being shown to the owner). */
export function openCall(call: DispatchCall, lang: Lang = call.lang): Turn {
  const L = pack(lang);
  const f = call.facts;
  switch (call.kind) {
    case "next_load": {
      const first = call.options?.[0];
      return {
        say: L.nextOpen(f.name, emptyAtWords(L, f), first ? L.option(first) : "", Number(f.count ?? 1)),
        choices: offerChoices(L, 0, call),
        step: "offer:0",
      };
    }
    case "pickup_brief":
    case "delivery_brief": {
      const pickup = call.kind === "pickup_brief";
      return {
        say: L.briefOpen({
          name: f.name,
          eta: L.duration(Number(f.etaMin)),
          place: f.place,
          city: f.city,
          numberLine: numberLine(L, f),
          note: noteWords(L, call),
          appt: apptWords(L, f),
        }),
        choices: [c(L.ch.sayNumber, "number", "number|again|repeat"), ...(pickup ? [] : [c(L.ch.lumperQ, "lumper", "lumper|unload")]), c(L.ch.gotIt, "bye", "got it|thank|ok|okay|bye|good")],
        step: "brief",
      };
    }
    case "late_eta":
      return {
        say: L.lateOpen({ name: f.name, road: f.road, delay: Number(f.delay), city: f.city, was: L.hour(Number(f.was)), now: L.hour(Number(f.now)) }),
        choices: [c(L.ch.goAround, "route", "around|route|another|detour"), c(L.ch.okThanks, "bye", "ok|okay|thank|got it|bye")],
        step: "late",
      };
    case "hours_parking":
      return {
        say: L.parkOpen({ name: f.name, hours: Number(f.hours), miles: Number(f.miles), stop: stopWords(L, f), ahead: Number(f.ahead), cost: Number(f.cost) }),
        choices: [c(L.ch.bookSpot, "reserve", "book|reserve|yes|yeah|sure"), c(L.ch.findOwn, "own", "own|no|myself|nah")],
        step: "parking",
      };
    case "inbound":
      return { say: L.inOpen(f.name), choices: INBOUND_MENU(L), step: "menu" };
    case "setup":
      return {
        say: L.setupOpen(f.name),
        choices: [c(L.ch.early6, "early:6", "six|6"), c(L.ch.early8, "early:8", "eight|8"), c(L.ch.earlyAny, "early:any", "any|whenever|anytime")],
        step: "setup:early",
      };
  }
}

const PREF_VALUES: Record<PrefKey, DriverPrefs> = {
  "early:6": { noCallsBefore: 6 },
  "early:8": { noCallsBefore: 8 },
  "early:any": { noCallsBefore: undefined },
  "avoid:NJ": { avoidStates: ["NJ"] },
  "avoid:CA": { avoidStates: ["CA"] },
  "avoid:none": { avoidStates: [] },
  "loads:call": { newLoads: "call" },
  "loads:text": { newLoads: "text" },
};

/** The driver's call settings in plain words, for the end of the setup call and the Profile page. */
export function describePrefs(prefs: DriverPrefs, lang: Lang = "en"): string[] {
  const L = pack(lang);
  const avoid = prefs.avoidStates ?? [];
  return [
    prefs.noCallsBefore !== undefined ? L.prefLine.noCallsBefore(L.hour(prefs.noCallsBefore)) : L.prefLine.anyTime,
    avoid.length ? L.prefLine.noLoadsInto(avoid.map((s) => L.stateName[s] ?? s)) : L.prefLine.anyState,
    prefs.newLoads === "text" ? L.prefLine.loadsText : L.prefLine.loadsCall,
  ];
}

function mergedPrefs(effects: DispatchCallEffect[], add: DriverPrefs): DispatchCallEffect[] {
  const prev = effects.find((e) => e.type === "prefs");
  const prefs = { ...(prev?.type === "prefs" ? prev.prefs : {}), ...add };
  return [...effects.filter((e) => e.type !== "prefs"), { type: "prefs", prefs }];
}

/** The AI's answer to what the driver said, in `lang`. Say that again and get me a person always work. */
export function respond(call: DispatchCall, reply: string, lang: Lang = call.lang): Turn {
  const L = pack(lang);
  const f = call.facts;
  const lastAi = [...call.lines].reverse().find((l) => l.speaker === "ai");
  const lastAiText = (lang === call.lang ? lastAi?.text : (lastAi?.tr?.[lang] ?? lastAi?.text)) ?? "";

  if (reply === "again") return { say: lastAiText, choices: call.choices, step: call.step };
  if (reply === "person") {
    return { say: L.person, choices: [], step: "person", end: true, report: { person: `${f.name} asked for a person` }, outcome: `${f.name} asked for a person. Call back` };
  }

  if (call.kind === "next_load") {
    const turn = nextLoadTurn(L, call, reply);
    if (turn) return turn;
  }
  if (call.kind === "inbound") {
    const turn = inboundTurn(L, call, reply);
    if (turn) return turn;
  }

  if (call.kind === "pickup_brief" || call.kind === "delivery_brief") {
    const kindLabel = pack("en").numberKind[f.numberKind as "pickup"] ?? "Number";
    const choices = openCall(call, lang).choices;
    if (reply === "number") return { say: L.repeatNumber(numberLine(L, f)), choices: choices.filter((ch) => call.choices.some((x) => x.reply === ch.reply)), step: "brief" };
    if (reply === "lumper") return { say: L.lumper(Number(f.lumper)), choices: choices.filter((ch) => ch.reply !== "lumper"), step: "brief" };
    if (reply === "bye") return { say: L.driveSafe, choices: [], step: "end", end: true, outcome: `${kindLabel} and dock rules given, texted` };
  }

  if (call.kind === "late_eta") {
    if (reply === "route") return { say: L.route, choices: [c(L.ch.okThanks, "bye", "ok|okay|thank|got it|bye")], step: "late" };
    if (reply === "bye") return { say: L.driveSafe, choices: [], step: "end", end: true, outcome: `Driver knows the new ${pack("en").hour(Number(f.now))} appointment` };
  }

  if (call.kind === "hours_parking") {
    const stopEn = stopWords(pack("en"), f);
    if (reply === "reserve") {
      return {
        say: L.reserved(stopWords(L, f)),
        choices: [c(L.ch.cancelThat, "cancel", "cancel|wait|stop|undo"), c(L.ch.thanksBye, "bye", "thank|bye|ok|okay|good")],
        step: "reserved",
        effects: [{ type: "reserve_parking", place: stopEn, cost: Number(f.cost) }],
        outcome: `Parking reserved at ${stopEn} ($${f.cost})`,
      };
    }
    if (reply === "cancel") return { say: L.parkCancelled, choices: [], step: "end", end: true, effects: [], outcome: "Driver finding their own parking" };
    if (reply === "own") return { say: L.parkOwn, choices: [], step: "end", end: true, outcome: "Driver finding their own parking" };
    if (reply === "bye") return { say: L.restUp, choices: [], step: "end", end: true };
  }

  if (call.kind === "setup") {
    const key = reply as PrefKey;
    const value = PREF_VALUES[key];
    const effects = value ? mergedPrefs(call.effects, value) : call.effects;
    if (call.step === "setup:early" && value) {
      return {
        say: L.setupQ2(L.prefSaid[key]),
        choices: [c(L.ch.avoidNJ, "avoid:NJ", "jersey|new york|nyc|city"), c(L.ch.avoidCA, "avoid:CA", "california|cali"), c(L.ch.avoidNone, "avoid:none", "anywhere|none|no|all")],
        step: "setup:avoid",
        effects,
      };
    }
    if (call.step === "setup:avoid" && value) {
      return {
        say: L.setupQ3(L.prefSaid[key]),
        choices: [c(L.ch.loadsCall, "loads:call", "call|phone"), c(L.ch.loadsText, "loads:text", "text|message")],
        step: "setup:loads",
        effects,
      };
    }
    if (call.step === "setup:loads" && value) {
      const saved = effects.find((e) => e.type === "prefs");
      return { say: L.setupDone(describePrefs(saved?.type === "prefs" ? saved.prefs : {}, lang)), choices: [], step: "end", end: true, effects, outcome: "Call preferences set" };
    }
  }

  return { say: L.sorry, choices: call.choices, step: call.step };
}

/** Offering loads: the same whether the AI called about them or the driver called and asked. */
function nextLoadTurn(L: CallPack, call: DispatchCall, reply: string): Turn | null {
  const f = call.facts;
  const opts = call.options ?? [];
  if (reply.startsWith("book:")) {
    const opt = opts[Number(reply.slice(5))];
    if (!opt || !f.groupId) return { say: L.gone, choices: [], step: "end", end: true };
    return {
      say: L.booking(opt.origin, opt.dest),
      choices: [c(L.ch.cancelThat, "cancel", "cancel|wait|stop|undo"), c(L.ch.thanksBye, "bye", "thank|bye|ok|okay|good")],
      step: "booked",
      effects: [{ type: "book", groupId: f.groupId, loadId: opt.loadId }],
      outcome: `Booked ${opt.short}`,
    };
  }
  if (reply.startsWith("next:")) {
    const i = Number(reply.slice(5));
    return { say: L.nextMore(opts[i] ? L.option(opts[i]) : ""), choices: offerChoices(L, i, call), step: `offer:${i}` };
  }
  if (reply === "cancel") return { say: L.cancelledLoad, choices: [], step: "end", end: true, effects: [], outcome: "Driver cancelled on the call. Nothing booked" };
  if (reply === "later") return { say: L.later, choices: [], step: "end", end: true, outcome: "Driver will pick in the app" };
  if (reply === "bye") return { say: L.byeLoad, choices: [], step: "end", end: true };
  return null;
}

/** A driver calling in: the handful of reasons drivers actually call dispatch, each handled on the spot. */
function inboundTurn(L: CallPack, call: DispatchCall, reply: string): Turn | null {
  const f = call.facts;
  if (call.step.startsWith("offer") || call.step === "booked") {
    const turn = nextLoadTurn(L, call, reply);
    if (turn) return turn;
  }
  const THANKS = c(L.ch.thanks, "bye", "thank|ok|okay|bye|good|got it");
  switch (reply) {
    case "next_q": {
      if (f.bookedOrigin) {
        const desc = L.bookedDesc({ origin: f.bookedOrigin, dest: f.bookedDest, miles: Number(f.bookedMiles), day: f.bookedDay === "tomorrow" ? "tomorrow" : "today" });
        return { say: L.inBooked(desc), choices: [THANKS], step: "answered", facts: { topic: "next" }, outcome: "Next load read back" };
      }
      const first = call.options?.[0];
      if (first && f.groupId) {
        return { say: L.inOptions(Number(f.count), emptyAtWords(L, f), L.option(first)), choices: offerChoices(L, 0, call), step: "offer:0", facts: { topic: "next" } };
      }
      return { say: L.inNothing, choices: [THANKS], step: "answered", facts: { topic: "next" }, outcome: "Nothing booked yet, told the driver" };
    }
    case "breakdown":
      return { say: L.bdQ, choices: [c(L.ch.safeYes, "safe", "yes|safe|shoulder|fine|parked"), c(L.ch.dangerNo, "danger", "no|help|hurt|accident|fire")], step: "breakdown" };
    case "safe":
      return {
        say: L.bdSafe,
        choices: [],
        step: "end",
        end: true,
        report: { incident: { type: "breakdown", note: `${f.name} called in a breakdown. Off the road and safe` } },
        outcome: "Breakdown reported. AI finding a shop",
        facts: { topic: "breakdown" },
      };
    case "danger":
      return {
        say: L.bdDanger,
        choices: [],
        step: "end",
        end: true,
        report: { incident: { type: "breakdown", note: `${f.name} called in a breakdown and needs help now` }, person: `${f.name} broke down and says they need help now` },
        outcome: "Breakdown, driver needs help. Office alerted",
        facts: { topic: "breakdown" },
      };
    case "late":
      return { say: L.lateQ, choices: [c(L.ch.late30, "late:30", "thirty|30|half"), c(L.ch.late60, "late:60", "hour|one|60"), c(L.ch.late120, "late:120", "two|more|2")], step: "late" };
    case "late:30":
    case "late:60":
    case "late:120": {
      const mins = Number(reply.slice(5)) as 30 | 60 | 120;
      const saidEn = pack("en").lateAmount[mins];
      return {
        say: L.lateConfirm(L.lateAmount[mins]),
        choices: [],
        step: "end",
        end: true,
        report: { incident: { type: "delay", note: `${f.name} called in running ${saidEn} late` } },
        outcome: `Running ${saidEn} late. AI moving the appointment`,
        facts: { topic: "late", late: String(mins) },
      };
    }
    case "pay":
      return {
        say: Number(f.weekLoads) > 0 ? L.pay(money(f.weekPay), Number(f.weekLoads)) : L.payNone,
        choices: [THANKS],
        step: "answered",
        outcome: "Pay question answered",
        facts: { topic: "pay" },
      };
    case "bye":
      return { say: L.inBye, choices: [], step: "end", end: true, outcome: call.outcome ?? "Question answered" };
  }
  return null;
}

/** The text that lands in the driver's Messages when the call ends, or instead of a call that couldn't happen. */
export function textCopyFor(call: DispatchCall): string {
  const L = pack(call.lang);
  const f = call.facts;
  const booked = call.effects.find((e) => e.type === "book");
  const bookedShort = booked?.type === "book" ? call.options?.find((o) => o.loadId === booked.loadId)?.short : undefined;
  switch (call.kind) {
    case "next_load":
      return bookedShort ? L.txt.booked(bookedShort) : L.txt.options(emptyAtWords(L, f), (call.options ?? []).map((o) => o.short));
    case "pickup_brief":
    case "delivery_brief":
      return L.txt.brief({
        pickup: call.kind === "pickup_brief",
        place: f.place,
        city: f.city,
        numberKind: L.numberKind[f.numberKind as "pickup"] ?? L.numberKind.pickup,
        number: `${f.prefix ? f.prefix + " " : ""}${f.number}`,
        appt: apptWords(L, f),
        note: noteWords(L, call),
      });
    case "late_eta":
      return L.txt.late({ city: f.city, was: L.hour(Number(f.was)), now: L.hour(Number(f.now)), road: f.road });
    case "hours_parking": {
      const p = { stop: cap(stopWords(L, f)), ahead: Number(f.ahead), cost: Number(f.cost) };
      return call.effects.some((e) => e.type === "reserve_parking") ? L.txt.parkReserved(p) : L.txt.parkNot(p);
    }
    case "setup":
      return L.txt.setup;
    case "inbound":
      if (bookedShort) return L.txt.booked(bookedShort);
      if (f.topic === "pay") return L.txt.inPay(money(f.weekPay), Number(f.weekLoads));
      if (f.topic === "breakdown") return L.txt.inBreakdown;
      if (f.topic === "late") return L.txt.inLate(L.lateAmount[Number(f.late) as 30 | 60 | 120] ?? "");
      return L.txt.inGeneric;
  }
}

/** The text a driver gets when the AI books their next load on its own. */
export function autoBookedText(lang: Lang, load: Load): string {
  return pack(lang).txt.autoBooked({ origin: load.lane.origin, dest: load.lane.destination, miles: load.lane.miles, pickup: load.pickupWindow });
}

/** Whether this call still matters: a brief for a stop already reached, or offers already picked, isn't worth a ring. */
export function stillRelevant(call: DispatchCall, loads: Load[]): boolean {
  const load = call.loadId ? loads.find((l) => l.id === call.loadId) : undefined;
  switch (call.kind) {
    case "next_load":
      return !!call.facts.groupId && loads.some((l) => l.offerGroupId === call.facts.groupId && l.stage === "offered");
    case "pickup_brief":
      return load?.stage === "dispatched";
    case "delivery_brief":
    case "late_eta":
    case "hours_parking":
      return load?.stage === "in_transit";
    case "setup":
    case "inbound":
      return true;
  }
}

/**
 * What the driver meant, from what they said out loud. English choices carry their own voice words; in every
 * language a number works ("two", "dos", "ਦੋ"), and so does a word from the button. "Again", "a person" and
 * "hang up" always work. Returns a reply, "hangup", or null.
 */
export function matchSpoken(heard: string, call: DispatchCall): string | null {
  const L = pack(call.lang);
  const h = heard.toLowerCase().trim();
  const tokens = h.split(/[\s,.!?¿¡।]+/).filter(Boolean);
  const has = (w: string) => (w.includes(" ") ? h.includes(w) : tokens.includes(w));
  if (call.lang === "en") {
    for (const ch of call.choices) if (ch.match && new RegExp(`\\b(${ch.match})`).test(h)) return ch.reply;
  }
  const byNumber = L.words.numbers.findIndex((ws) => ws.some(has));
  if (byNumber >= 0 && call.choices[byNumber]) return call.choices[byNumber].reply;
  if (L.words.again.some((w) => h.includes(w))) return "again";
  if (L.words.person.some((w) => h.includes(w))) return "person";
  if (L.words.hangup.some((w) => h.includes(w))) return "hangup";
  for (const ch of call.choices) {
    const words = ch.label.toLowerCase().split(/[\s,.!?¿¡।]+/).filter((w) => w.length >= 4);
    if (words.some((w) => h.includes(w))) return ch.reply;
  }
  if (call.lang === "en") return null;
  // English trucking words work in every language ("book it", "cancel").
  for (const ch of call.choices) if (ch.match && new RegExp(`\\b(${ch.match})`).test(h)) return ch.reply;
  return null;
}
