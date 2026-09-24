import { computeDriverPay } from "./settlements";
import { formatEta, legMiles } from "./trip-geo";
import type { DispatchCall, DispatchCallChoice, DispatchCallEffect, DispatchCallKind, Driver, DriverPrefs, Load } from "./types";

/**
 * The calls a human dispatcher makes all day, scripted: a load to offer, the pickup number before the gate, the
 * receiver's rules before delivery, a late appointment already fixed, and where to park when hours run out. Every
 * call is short, says numbers in groups the way people read them over the phone, and ends with a text copy so the
 * driver never writes anything down while driving. Each turn is decided here; the store only applies the result.
 */

export const KIND_LABEL: Record<DispatchCallKind, string> = {
  next_load: "Next load",
  pickup_brief: "Before pickup",
  delivery_brief: "Before delivery",
  late_eta: "Running late",
  hours_parking: "Hours and parking",
  setup: "Call setup",
};

/** How long the phone rings before it counts as missed and the AI texts instead. */
export const RING_MS = 25_000;
/** Space between two calls to the same driver, so the phone isn't ringing back to back. */
export const CALL_GAP_MS = 20_000;

const SHIPPERS = ["Great Plains Foods", "Lone Star Packaging", "Midway Paper Co.", "Summit Beverage", "Keystone Building Supply", "Harbor Cold Storage", "Redline Auto Parts", "Prairie Grain Mills"];
const RECEIVERS = ["Walmart DC 6012", "Kroger DC", "Home Depot RDC", "Target DC 3807", "Sysco", "H-E-B Warehouse", "Costco Depot", "Lowe's RDC"];
const PICKUP_NOTES = [
  "Check in at the guard shack with that number and they'll give you a door",
  "Trucks go in through the back gate off the service road, not the front lot",
  "It's a live load, about two hours. Your detention clock starts at check-in",
  "Shipping office is on the left as you pull in. They want your seal number on the BOL",
];
const DELIVERY_NOTES = [
  "Receiving is around the back. Call-in is on the sign at the gate",
  "They're strict on appointments, so check in 15 minutes early",
  "They unload, you wait in the truck. Get the POD signed before you pull off",
  "No overnight parking on site, so don't show up early the night before",
];
const ROADS = ["I-40", "I-35", "I-20", "I-30", "I-45", "I-10", "I-44"];
const STOPS = ["the TA", "the Pilot", "the Love's", "the Petro"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const from = <T,>(arr: T[], seed: number) => arr[seed % arr.length];

/** "482719" → "4 8 2, 7 1 9": the way a dispatcher reads a number so it sticks. */
export function sayDigits(n: string): string {
  const groups = n.match(/.{1,3}/g) ?? [n];
  return groups.map((g) => g.split("").join(" ")).join(", ");
}

function hourLabel(h: number): string {
  const hr = ((h + 11) % 12) + 1;
  return `${hr} ${h < 12 ? "AM" : "PM"}`;
}

const firstName = (d: Driver) => d.name.split(" ")[0];

/** Whether the AI would drop this load into the driver's lap right now. */
export function driverTakes(prefs: DriverPrefs | undefined, load: Pick<Load, "lane">): boolean {
  const avoid = prefs?.avoidStates ?? [];
  return !avoid.includes(load.lane.destState) && !avoid.includes(load.lane.originState);
}

/** About three loads in ten hit something on the way that moves the appointment. Decided per load, so it's stable. */
export function lateOnThisLoad(loadId: string): boolean {
  return hash(loadId + "late") % 10 < 3;
}

/** Why a call can't ring right now, or null when it can. Sleeper and off duty are never interrupted. */
export function quietReason(driver: Driver, now: Date): string | null {
  if (driver.hosStatus === "sleeper") return `${firstName(driver)}'s in the sleeper`;
  if (driver.hosStatus === "off_duty") return `${firstName(driver)}'s off duty`;
  const before = driver.prefs?.noCallsBefore;
  if (before !== undefined && now.getHours() < before) return `No calls before ${hourLabel(before)}`;
  return null;
}

interface NewCall {
  kind: DispatchCallKind;
  driver: Driver;
  load?: Load;
  facts?: Record<string, string>;
  options?: DispatchCall["options"];
}

export function newDispatchCall({ kind, driver, load, facts = {}, options }: NewCall): DispatchCall {
  return {
    id: `dcall-${Math.random().toString(36).slice(2, 10)}`,
    driverId: driver.id,
    carrierId: driver.carrierId,
    loadId: load?.id,
    kind,
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

/** The next-load call reads the options best-first, in the driver's own money: what they make, not what the truck grosses. */
export function nextLoadCall(driver: Driver, offers: Load[], emptyAt: string, team: boolean): DispatchCall | null {
  const ranked = [...offers].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || b.score - a.score).slice(0, 3);
  if (!ranked.length || !ranked[0].offerGroupId) return null;
  const local = driver.runType === "local" || driver.runType === "intown";
  const options = ranked.map((l) => {
    const pay = Math.round(computeDriverPay(l, driver, team) / 5) * 5;
    const home =
      l.hoursHomeAfter === undefined
        ? ""
        : local
          ? l.homeTonight
            ? " You're home tonight."
            : " It runs late, so you'd get home late."
          : l.hoursHomeAfter < 1
            ? " It delivers right by home."
            : ` Leaves you about ${Math.round(l.hoursHomeAfter)} hours from home.`;
    const move = l.lane.moveKind ? "move" : "load";
    return {
      loadId: l.id,
      short: `${l.lane.origin} → ${l.lane.destination}, $${(l.bookedRate ?? l.targetRate).toLocaleString()}`,
      say: `${l.lane.origin} to ${l.lane.destination}, ${l.lane.miles} miles, picks up ${l.pickupWindow.split(",")[0].toLowerCase()}. You'd make about $${pay.toLocaleString()} on this ${move}.${home}`,
    };
  });
  const call = newDispatchCall({ kind: "next_load", driver, load: ranked[0], options, facts: { groupId: ranked[0].offerGroupId, emptyAt, count: String(offers.length) } });
  return call;
}

/** The appointment the way you'd say it on the phone, from whatever the load carries. Loads without a set time get
 *  the receiver's usual one. */
function apptPhrase(window: string, h: number): string {
  const moved = window.match(/Moved to (\d+ [AP]M)/);
  if (moved) return `Your appointment is ${moved[1]}`;
  const slot = window.match(/appointment (\d+):00 ([AP]M)/);
  if (slot) return `Your appointment is ${slot[1]} ${slot[2]}`;
  if (/^Tomorrow, 7 AM/.test(window)) return "Your appointment is tomorrow at 7 AM";
  const range = window.match(/(\d+):00–(\d+):00/);
  if (range) return `They load between ${hourLabel(Number(range[1]))} and ${hourLabel(Number(range[2]))}`;
  return `Your appointment is ${hourLabel(8 + (h % 8))}`;
}

export function briefCall(driver: Driver, load: Load, stop: "pickup" | "delivery", legP: number): DispatchCall {
  const h = hash(load.id + stop);
  const number = String(100000 + (h % 900000));
  const container = load.lane.moveKind === "container_pickup" || load.lane.moveKind === "empty_return";
  const place = stop === "pickup" ? from(SHIPPERS, h) : from(RECEIVERS, h);
  const city = stop === "pickup" ? load.lane.origin : load.lane.destination;
  const milesLeft = Math.max(4, Math.round(legMiles(load, stop) * (1 - legP)));
  return newDispatchCall({
    kind: stop === "pickup" ? "pickup_brief" : "delivery_brief",
    driver,
    load,
    facts: {
      place,
      city,
      number,
      numberKind: container ? "Container number" : stop === "pickup" ? "Pickup number" : "Delivery number",
      prefix: container ? from(["MSCU", "MAEU", "CMAU", "HLXU"], h) : "",
      eta: formatEta(milesLeft),
      appt: apptPhrase(stop === "pickup" ? load.pickupWindow : load.deliveryWindow, h),
      note: stop === "pickup" ? from(PICKUP_NOTES, h >>> 3) : from(DELIVERY_NOTES, h >>> 3),
      door: String(3 + (h % 38)),
      lumper: String(150 + (h % 4) * 25),
    },
  });
}

/** The AI has already fixed the appointment; the call just makes sure the driver knows. */
export function lateCall(driver: Driver, load: Load): { call: DispatchCall; newWindow: string } {
  const h = hash(load.id + "late");
  const delay = 30 + (h % 4) * 15;
  const appt = 9 + (h % 8);
  const moved = appt + Math.ceil(delay / 60);
  const newWindow = `Moved to ${hourLabel(moved)} (was ${hourLabel(appt)})`;
  return {
    newWindow,
    call: newDispatchCall({
      kind: "late_eta",
      driver,
      load,
      facts: { road: from(ROADS, h), delay: String(delay), was: hourLabel(appt), now: hourLabel(moved), city: load.lane.destination },
    }),
  };
}

/** Out of hours before the receiver: a parking spot ahead and a delivery moved to the morning. */
export function parkingCall(driver: Driver, load: Load, milesLeft: number): { call: DispatchCall; newWindow: string } {
  const h = hash(load.id + "park");
  const hoursLeft = driver.hoursRemaining;
  const ahead = Math.max(20, Math.round(hoursLeft * 50 * 0.85));
  return {
    newWindow: "Tomorrow, 7 AM (moved, out of hours)",
    call: newDispatchCall({
      kind: "hours_parking",
      driver,
      load,
      facts: {
        hours: hoursLeft < 1 ? "under an hour" : `about ${Math.round(hoursLeft)} hours`,
        miles: String(Math.round(milesLeft)),
        stop: `${from(STOPS, h)} at exit ${40 + (h % 300)}`,
        ahead: String(ahead),
        cost: String(15 + (h % 3) * 5),
      },
    }),
  };
}

export function setupCall(driver: Driver): DispatchCall {
  return newDispatchCall({ kind: "setup", driver });
}

// ——— The conversation ———

export interface Turn {
  say: string;
  choices: DispatchCallChoice[];
  step: string;
  /** Replaces the call's effects when set. */
  effects?: DispatchCallEffect[];
  end?: boolean;
  outcome?: string;
  /** The driver asked for a person — the store raises it for the carrier. */
  person?: boolean;
}

const c = (label: string, reply: string, match?: string, say = label): DispatchCallChoice => ({ label, reply, say, match });
const BYE = c("Got it, thanks", "bye", "got it|thank|ok|okay|bye|good");

function numberLine(f: Record<string, string>): string {
  const spoken = f.prefix ? `${f.prefix.split("").join(" ")}, ${sayDigits(f.number)}` : sayDigits(f.number);
  return `${f.numberKind} is ${spoken}.`;
}

/** What the AI says when the driver picks up. */
export function openCall(call: DispatchCall): Turn {
  const f = call.facts;
  switch (call.kind) {
    case "next_load": {
      const first = call.options?.[0];
      const count = Number(f.count ?? 1);
      return {
        say: `Hey ${f.name}, it's your AI dispatcher. Got a load for you ${f.emptyAt}. ${first?.say ?? ""} ${count > 1 ? `That's the best of ${count} I found.` : ""} Want it?`.replace(/\s+/g, " "),
        choices: offerChoices(0, call),
        step: "offer:0",
      };
    }
    case "pickup_brief":
    case "delivery_brief": {
      const pickup = call.kind === "pickup_brief";
      return {
        say: `Hey ${f.name}, quick one before you get there. You're about ${f.eta} from ${f.place} in ${f.city}. ${numberLine(f)} ${f.note}. ${f.appt}, and I already told the broker you're close. I texted you all of this.`,
        choices: [c("Say the number again", "number", "number|again|repeat"), ...(pickup ? [] : [c("What if there's a lumper?", "lumper", "lumper|unload")]), BYE],
        step: "brief",
      };
    }
    case "late_eta":
      return {
        say: `Heads up, ${f.name}. There's a wreck on ${f.road} ahead, adds about ${f.delay} minutes. I already called the receiver in ${f.city} and moved your appointment from ${f.was} to ${f.now}, and told the broker. Nothing for you to do.`,
        choices: [c("Should I go around?", "route", "around|route|another|detour"), c("OK, thanks", "bye", "ok|okay|thank|got it|bye")],
        step: "late",
      };
    case "hours_parking":
      return {
        say: `${f.name}, you've got ${f.hours} of driving left and ${f.miles} miles to go, so you won't make the receiver today. I already moved your delivery to tomorrow at 7 AM and told the broker. ${cap(f.stop)}, ${f.ahead} miles ahead, takes reservations, $${f.cost} for the night. Want me to book you a spot? Lots around there fill up by 7.`,
        choices: [c("Book the spot", "reserve", "book|reserve|yes|yeah|sure"), c("I'll find my own", "own", "own|no|myself|nah")],
        step: "parking",
      };
    case "setup":
      return {
        say: `Hi ${f.name}, it's your AI dispatcher. Three quick questions so I only call when it's worth it. First, what's the earliest I can call you?`,
        choices: [c("6 AM", "early:6", "six|6"), c("8 AM", "early:8", "eight|8"), c("Any time", "early:any", "any|whenever|anytime")],
        step: "setup:early",
      };
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function offerChoices(i: number, call: DispatchCall): DispatchCallChoice[] {
  const more = (call.options?.length ?? 0) > i + 1;
  return [
    c(i === 0 ? "Book it" : "Book this one", `book:${i}`, "book|yes|yeah|take it|sure|sounds good"),
    ...(more ? [c("What else?", `next:${i + 1}`, "else|other|next|another")] : i > 0 ? [c("Book the first one", "book:0", "first")] : []),
    c("Not now", "later", "not now|later|no|pass|nah"),
  ];
}

const PREF_WORDS: Record<string, { prefs: DriverPrefs; said: string }> = {
  "early:6": { prefs: { noCallsBefore: 6 }, said: "I won't call before 6 AM" },
  "early:8": { prefs: { noCallsBefore: 8 }, said: "I won't call before 8 AM" },
  "early:any": { prefs: { noCallsBefore: undefined }, said: "I'll call any time you're on duty" },
  "avoid:NJ": { prefs: { avoidStates: ["NJ"] }, said: "I'll keep you out of New Jersey and the city" },
  "avoid:CA": { prefs: { avoidStates: ["CA"] }, said: "I'll keep you out of California" },
  "avoid:none": { prefs: { avoidStates: [] }, said: "I'll send you anywhere that pays" },
  "loads:call": { prefs: { newLoads: "call" }, said: "I'll call you with new loads" },
  "loads:text": { prefs: { newLoads: "text" }, said: "I'll text you new loads instead of calling" },
};

/** The driver's call settings in plain words, for the end of the setup call and the Profile page. */
export function describePrefs(prefs: DriverPrefs): string[] {
  const avoid = prefs.avoidStates ?? [];
  return [
    prefs.noCallsBefore !== undefined ? `No calls before ${hourLabel(prefs.noCallsBefore)}` : "Calls any time you're on duty",
    avoid.length ? `No loads into ${avoid.map((s) => STATE_NAME[s] ?? s).join(" or ")}` : "Loads into any state",
    prefs.newLoads === "text" ? "New loads by text" : "New loads by phone call",
  ];
}

const STATE_NAME: Record<string, string> = { NJ: "New Jersey", CA: "California" };

function mergedPrefs(effects: DispatchCallEffect[], add: DriverPrefs): DispatchCallEffect[] {
  const prev = effects.find((e) => e.type === "prefs");
  const prefs = { ...(prev?.type === "prefs" ? prev.prefs : {}), ...add };
  return [...effects.filter((e) => e.type !== "prefs"), { type: "prefs", prefs }];
}

/** The AI's answer to what the driver said. The three things that always work — say that again, get me a person,
 *  and hanging up — are handled before any script. */
export function respond(call: DispatchCall, reply: string): Turn {
  const f = call.facts;
  const lastAi = [...call.lines].reverse().find((l) => l.speaker === "ai")?.text ?? "";

  if (reply === "again") return { say: lastAi, choices: call.choices, step: call.step };
  if (reply === "person") {
    return {
      say: `Sure. I'm getting someone from the office to call you back, usually within 10 minutes. Anything we already set up stays as is.`,
      choices: [],
      step: "person",
      end: true,
      person: true,
      outcome: `${f.name} asked for a person. Call back`,
    };
  }

  if (call.kind === "next_load") {
    const opts = call.options ?? [];
    if (reply.startsWith("book:")) {
      const i = Number(reply.slice(5));
      const opt = opts[i];
      if (!opt || !f.groupId) return { say: "That one's gone. Let me look again and call you back.", choices: [], step: "end", end: true };
      return {
        say: `Done. Booking ${opt.short.split(",")[0].replace(" → ", " to ")}. I'll text you the pickup details once the rate con's signed. Changed your mind? Say cancel in the next few seconds.`,
        choices: [c("Cancel that", "cancel", "cancel|wait|stop|undo"), c("Thanks, bye", "bye", "thank|bye|ok|okay|good")],
        step: "booked",
        effects: [{ type: "book", groupId: f.groupId, loadId: opt.loadId }],
        outcome: `Booked ${opt.short}`,
      };
    }
    if (reply.startsWith("next:")) {
      const i = Number(reply.slice(5));
      return { say: `Next one: ${opts[i]?.say ?? ""}`, choices: offerChoices(i, call), step: `offer:${i}` };
    }
    if (reply === "cancel") {
      return {
        say: "Cancelled, nothing's booked. The options are still on your Home screen, and I'll check back in about 30 minutes. Loads go fast, so don't wait too long.",
        choices: [],
        step: "end",
        end: true,
        effects: [],
        outcome: "Driver cancelled on the call. Nothing booked",
      };
    }
    if (reply === "later") {
      return {
        say: "No problem. They're on your Home screen whenever you're ready. Loads go fast, so I'll check back in about 30 minutes.",
        choices: [],
        step: "end",
        end: true,
        outcome: "Driver will pick in the app",
      };
    }
    if (reply === "bye") return { say: "You got it. Drive safe.", choices: [], step: "end", end: true };
  }

  if (call.kind === "pickup_brief" || call.kind === "delivery_brief") {
    if (reply === "number") return { say: `${numberLine(f)} It's in your texts too.`, choices: call.choices, step: "brief" };
    if (reply === "lumper") {
      return {
        say: `If they want a lumper, the broker covers up to $${f.lumper}. Pay with the fleet card, get a receipt, and snap it in the app. I'll bill it back.`,
        choices: call.choices.filter((ch) => ch.reply !== "lumper"),
        step: "brief",
      };
    }
    if (reply === "bye") return { say: "Drive safe.", choices: [], step: "end", end: true, outcome: `${f.numberKind} and dock rules given, texted` };
  }

  if (call.kind === "late_eta") {
    if (reply === "route") {
      return {
        say: "I don't have a better route than your truck GPS. Going around this one adds more miles than it saves, so staying on it is still faster.",
        choices: [c("OK, thanks", "bye", "ok|okay|thank|got it|bye")],
        step: "late",
      };
    }
    if (reply === "bye") return { say: "Drive safe.", choices: [], step: "end", end: true, outcome: `Driver knows the new ${f.now} appointment` };
  }

  if (call.kind === "hours_parking") {
    if (reply === "reserve") {
      return {
        say: `Booked. The spot's under your company name at ${f.stop}, on the fleet card. Say cancel if you'd rather not.`,
        choices: [c("Cancel that", "cancel", "cancel|wait|stop|undo"), c("Thanks, bye", "bye", "thank|bye|ok|okay|good")],
        step: "reserved",
        effects: [{ type: "reserve_parking", place: f.stop, cost: Number(f.cost) }],
        outcome: `Parking reserved at ${f.stop} ($${f.cost})`,
      };
    }
    if (reply === "cancel") {
      return { say: "Cancelled, no spot booked. Don't leave it too late, those lots fill up.", choices: [], step: "end", end: true, effects: [], outcome: "Driver finding their own parking" };
    }
    if (reply === "own") {
      return { say: "OK. Don't leave it too late, those lots fill up. Delivery's still tomorrow at 7.", choices: [], step: "end", end: true, outcome: "Driver finding their own parking" };
    }
    if (reply === "bye") return { say: "Rest up. Talk tomorrow.", choices: [], step: "end", end: true };
  }

  if (call.kind === "setup") {
    const pref = PREF_WORDS[reply];
    const effects = pref ? mergedPrefs(call.effects, pref.prefs) : call.effects;
    if (call.step === "setup:early" && pref) {
      return {
        say: `Got it, ${pref.said}. And I never call while you're in the sleeper or off duty; I text instead. Any states you won't run to?`,
        choices: [c("No New Jersey or NYC", "avoid:NJ", "jersey|new york|nyc|city"), c("No California", "avoid:CA", "california|cali"), c("I'll go anywhere", "avoid:none", "anywhere|none|no|all")],
        step: "setup:avoid",
        effects,
      };
    }
    if (call.step === "setup:avoid" && pref) {
      return {
        say: `${pref.said}. Last one. When I find your next loads, do you want a call, or just a text?`,
        choices: [c("Call me", "loads:call", "call|phone"), c("Just text me", "loads:text", "text|message")],
        step: "setup:loads",
        effects,
      };
    }
    if (call.step === "setup:loads" && pref) {
      const saved = effects.find((e) => e.type === "prefs");
      const said = describePrefs(saved?.type === "prefs" ? saved.prefs : {});
      return {
        say: `All set. ${said.join(". ")}. You can change any of it in your Profile. Drive safe.`,
        choices: [],
        step: "end",
        end: true,
        effects,
        outcome: "Call preferences set",
      };
    }
  }

  return { say: "Sorry, I didn't catch that.", choices: call.choices, step: call.step };
}

/** The text that lands in the driver's Messages when the call ends, or instead of a call that couldn't happen. */
export function textCopyFor(call: DispatchCall): string {
  const f = call.facts;
  switch (call.kind) {
    case "next_load": {
      const booked = call.effects.find((e) => e.type === "book");
      if (booked) {
        const opt = call.options?.find((o) => o.loadId === booked.loadId);
        return `Booked from our call: ${opt?.short ?? "your next load"}. Pickup details come once the rate con is signed.`;
      }
      return `Load options ${f.emptyAt}:\n${(call.options ?? []).map((o, i) => `${i + 1}. ${o.short}`).join("\n")}\nPick one on your Home screen.`;
    }
    case "pickup_brief":
    case "delivery_brief":
      return `${call.kind === "pickup_brief" ? "Pickup" : "Delivery"}: ${f.place}, ${f.city}\n${f.numberKind}: ${f.prefix ? f.prefix + " " : ""}${f.number}\n${f.appt}\n${f.note}.`;
    case "late_eta":
      return `Your ${f.city} appointment moved from ${f.was} to ${f.now} (wreck on ${f.road}). The broker knows.`;
    case "hours_parking": {
      const parked = call.effects.find((e) => e.type === "reserve_parking");
      return parked
        ? `Parking reserved: ${f.stop}, ${f.ahead} mi ahead, $${f.cost} on the fleet card. Delivery moved to tomorrow 7 AM.`
        : `You're out of hours before the receiver. Delivery moved to tomorrow 7 AM. ${cap(f.stop)}, ${f.ahead} mi ahead, takes reservations ($${f.cost}).`;
    }
    case "setup":
      return "Your call settings are saved. Change them any time in Profile.";
  }
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
      return true;
  }
}
