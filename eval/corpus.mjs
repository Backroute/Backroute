// Every way people say the same thing to a dispatcher, generated: each intent has phrasings, filled-in details, an
// opening and a sign-off, and a "how it was typed" variation (typos, no punctuation, all caps, texting shorthand,
// emoji, radio talk). Some intents also come in the other six languages. Each message carries what the AI should do,
// so eval/run.mjs can score the real AI against it.

const CITIES = ["Dallas", "Fort Worth", "Memphis", "Atlanta", "Houston", "Laredo", "Nashville", "Little Rock", "Chicago", "Joliet", "Phoenix", "Ontario", "Columbus", "Indy", "Jacksonville", "Savannah", "El Paso", "Oklahoma City", "Kansas City", "St. Louis"];
const HWYS = ["10", "20", "30", "35", "40", "44", "55", "65", "70", "75", "80", "81", "85", "90", "95"];
const COMMODITIES = ["paper", "frozen chicken", "beverages", "auto parts", "produce", "steel coils", "lumber", "canned goods", "furniture", "plastic pellets"];
const NAMES = ["Kim", "Rosa", "Mike", "Dana", "Luis", "Priya", "Tom", "Ana"];
const money = (n) => (n % 3 === 0 ? `$${n.toLocaleString("en-US")}` : n % 3 === 1 ? `${n}` : `${n.toLocaleString("en-US")} dollars`);

const SLOTS = {
  city: CITIES,
  hwy: HWYS,
  exit: ["12", "47", "88", "103", "156", "212", "287", "330"],
  mins: ["20", "30", "45", "60", "90"],
  door: ["4", "12", "17", "22", "31"],
  seal: ["448812", "90331", "7712045", "551903"],
  n: ["2", "3", "4", "5"],
  money: [1150, 1375, 1600, 1850, 2100, 2350, 2600, 2900, 3200].map(money),
  rpm: ["2.10", "2.35", "2.50", "2.75", "3.00", "3.25"],
  weight: ["18,000", "32,500", "38,000", "41,200", "43,000", "44,500"],
  commodity: COMMODITIES,
  name: NAMES,
  ref: ["TQL-5501", "ACM-7721", "LS-2044", "CH-88213", "EQ-4410"],
};

const OPENERS = { driver: ["", "hey ", "yo ", "dispatch, ", "hey boss ", "ok so ", "quick one: ", "morning, ", "10-4, "], broker: ["", "yeah ", "ok ", "look, ", "honestly ", "so ", "alright "], email: ["", "Hi, ", "Hi team, ", "Good morning, ", "Hello, "] };
const CLOSERS = { driver: ["", " thanks", " thx", ".", " copy", " let me know", " asap", " 👍"], broker: ["", ".", " let me know", " what do you think?", " that's it"], email: ["", "\n\nThanks", "\n\nThanks,\nKim", "\n\nBest,\nRosa", "\n\nRegards"] };

// How it was typed.
const SHORT = [[/\byou\b/gi, "u"], [/\bare\b/gi, "r"], [/\bI'm\b/gi, "im"], [/\bgoing to\b/gi, "gonna"], [/\bright now\b/gi, "rn"], [/\bthanks\b/gi, "thx"], [/\bokay\b/gi, "ok"], [/\bplease\b/gi, "pls"], [/\bbecause\b/gi, "cuz"]];
const NOISE = [
  ["as written", (s) => s],
  ["lower case", (s) => s.toLowerCase()],
  ["no punctuation", (s) => s.replace(/[.,!?;:'"]/g, "")],
  ["all caps", (s) => s.toUpperCase()],
  ["typo", (s, r) => {
    const words = s.split(" ");
    const i = Math.floor(r() * words.length);
    const w = words[i];
    if (w.length > 3) { const j = 1 + Math.floor(r() * (w.length - 2)); words[i] = w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2); }
    return words.join(" ");
  }],
  ["texting shorthand", (s) => SHORT.reduce((t, [re, to]) => t.replace(re, to), s)],
  ["voice transcript", (s) => s.replace(/[.,!?;:]/g, "").replace(/\breefer\b/gi, "real fur").replace(/\bBOL\b/g, "b o l").replace(/\blumper\b/gi, "lumber").toLowerCase()],
];

const any = (...names) => (r) => r.tools?.some((t) => names.includes(t.tool));
const tool = (name, pred = () => true) => (r) => r.tools?.some((t) => t.tool === name && pred(t.input ?? {}));
const noActionTool = (r) => !r.tools?.some((t) => ["update_load_status", "report_problem", "driver_feedback", "tell_owner"].includes(t.tool));

/** Every intent: who says it, what the AI should do, the phrasings, and (some) the same in other languages. */
export const INTENTS = [
  { id: "driver.at_pickup", who: "driver", expect: tool("update_load_status", (i) => i.status === "at_pickup"), phrases: ["I'm at the shipper", "just pulled into the pickup in {city}", "at pickup, checking in", "made it to the shipper in {city}", "here at the dock for pickup", "arrived at pickup", "checked in at the shipper, they gave me door {door}", "at the DC to load", "on site at the shipper now", "I'm here to pick up"], langs: { es: ["ya estoy en el shipper", "llegué a cargar en {city}"], fr: ["je suis arrivé chez l'expéditeur", "je suis au chargement à {city}"], pa: ["ਮੈਂ ਸ਼ਿਪਰ ਤੇ ਪਹੁੰਚ ਗਿਆ ਹਾਂ"], hi: ["मैं पिकअप पर पहुँच गया हूँ"], ru: ["я на погрузке в {city}"], uk: ["я на завантаженні"] } },
  { id: "driver.loaded", who: "driver", expect: tool("update_load_status", (i) => i.status === "loaded"), phrases: ["loaded and rolling", "all loaded up, heading out", "got loaded, seal {seal}", "done loading, on the road", "just finished loading in {city}", "bills signed, I'm rolling", "loaded, leaving the shipper now", "pulling out loaded", "we're loaded, BOL signed", "finally loaded after {n} hours"], langs: { es: ["ya estoy cargado y voy en camino", "ya cargué, salgo ahora"], fr: ["je suis chargé, je roule", "chargement terminé, je pars"], pa: ["ਮੈਂ ਲੋਡ ਹੋ ਗਿਆ ਹਾਂ, ਚੱਲ ਪਿਆ"], hi: ["मैं लोड हो गया हूँ, निकल रहा हूँ"], ru: ["загрузился, выезжаю"], uk: ["завантажився, виїжджаю"] } },
  { id: "driver.at_delivery", who: "driver", expect: tool("update_load_status", (i) => i.status === "at_delivery"), phrases: ["at the receiver", "made it to delivery", "checked in at the consignee", "at delivery in {city}, waiting on a door", "here to unload", "arrived at the receiver", "at the drop, they said door {door}", "I'm at the delivery now"], langs: { es: ["ya llegué a entregar", "estoy en el receiver en {city}"], fr: ["je suis arrivé chez le client pour livrer"], ru: ["я на выгрузке"], hi: ["मैं डिलीवरी पर पहुँच गया हूँ"] } },
  { id: "driver.breakdown", who: "driver", expect: tool("report_problem", (i) => i.kind === "breakdown"), phrases: ["truck broke down on I-{hwy} near exit {exit}", "blew a tire on I-{hwy}", "check engine light on and losing power, pulled over", "reefer unit died on me", "air line busted, can't move", "engine's overheating, I'm on the shoulder at mile {exit}", "got a flat at the truck stop in {city}", "DEF warning, truck derated to 5 mph", "brakes locked up, stuck on I-{hwy}"], langs: { es: ["se me ponchó una llanta en la I-{hwy}", "se descompuso el camión cerca de {city}"], fr: ["le camion est en panne sur la I-{hwy}"], pa: ["ਟਰੱਕ ਖਰਾਬ ਹੋ ਗਿਆ ਹੈ I-{hwy} ਤੇ"], ru: ["сломался грузовик на I-{hwy}"] } },
  { id: "driver.accident", who: "driver", expect: tool("report_problem", (i) => i.kind === "accident"), phrases: ["I got hit at a light in {city}, nobody's hurt", "got rear ended on I-{hwy}", "hit a deer, front end is smashed", "had an accident, cops are here", "a car sideswiped my trailer", "backed into a pole at the dock, some damage"], langs: { es: ["tuve un accidente en {city}, nadie herido"], fr: ["j'ai eu un accident, personne n'est blessé"] } },
  { id: "driver.late", who: "driver", expect: tool("report_problem", (i) => ["late", "weather"].includes(i.kind)), phrases: ["running about {mins} minutes late, traffic", "gonna be late to delivery, wreck on I-{hwy}", "stuck in traffic, won't make my appointment", "weather's bad, gonna be a couple hours behind", "roads are closed near {city}, I'll be late", "shipper held me {n} hours, I'll miss the delivery time"], langs: { es: ["voy a llegar tarde como {mins} minutos"], fr: ["je vais être en retard de {mins} minutes"] } },
  { id: "driver.parking", who: "driver", expect: tool("find_nearby", (i) => ["parking", "truck_stop"].includes(i.kind)), phrases: ["where can I park tonight", "need a spot to park near {city}", "any truck parking around here", "looking for parking for my 10", "where's the closest truck stop to sleep", "running out of hours, need parking"], langs: { es: ["dónde me puedo estacionar esta noche"], fr: ["où je peux me garer ce soir"] } },
  { id: "driver.fuel", who: "driver", expect: tool("find_nearby", (i) => ["fuel", "truck_stop"].includes(i.kind)), phrases: ["where's the nearest diesel", "need fuel, where should I stop", "closest place to fuel up", "running low on fuel near {city}"] },
  { id: "driver.scale", who: "driver", expect: tool("find_nearby", (i) => i.kind === "scale"), phrases: ["need a CAT scale", "where can I scale this load", "closest scale around {city}", "I think I'm heavy, need to weigh"] },
  { id: "driver.unhappy", who: "driver", expect: tool("driver_feedback", (i) => i.mood === "bad"), phrases: ["honestly I'm fed up, pay's too low", "thinking about quitting", "I'm burnt out, haven't been home in 3 weeks", "not happy with the miles lately", "this job is killing me, something has to change"], langs: { es: ["ya estoy harto, pagan muy poco"] } },
  { id: "driver.owner", who: "driver", expect: any("tell_owner", "driver_feedback"), phrases: ["can you have the boss call me", "need to talk to the owner about my check", "tell the owner I need next Friday off", "I want to talk to a real person about my settlement"] },
  { id: "driver.question", who: "driver", expect: noActionTool, phrases: ["what's my pickup number", "what time is my delivery appointment", "what's the address for the receiver", "how many miles is this run", "who's the broker on this load", "when's my next load"], langs: { es: ["a qué hora es mi cita de entrega"], fr: ["c'est quoi l'adresse de livraison"] } },

  { id: "broker.offer", who: "broker", expect: tool("broker_offer"), phrases: ["I've got {money} on it", "best I can do is {money}", "we're paying {money} all in", "can you do {money}?", "I can go {money}", "{rpm} a mile is all I have", "shipper's only paying {money}", "I could do {money} if you can load today"] },
  { id: "broker.ask_rate", who: "broker", expect: tool("our_price"), phrases: ["what do you need on it?", "what's your rate?", "what are you looking for on this one", "give me a number", "what would it take to cover it?", "where do you need to be?"] },
  { id: "broker.covered", who: "broker", expect: tool("not_available"), phrases: ["sorry, that one's covered", "we already moved it", "that load got cancelled", "it's gone, sorry", "shipper cancelled that one", "we booked it an hour ago"] },
  { id: "broker.details", who: "broker", expect: tool("load_details"), phrases: ["yeah still have it, it's {weight} pounds of {commodity}", "{commodity}, about {weight} lbs, appointments are set", "it's {weight} pounds, {commodity}, first come first served", "{weight} lbs of {commodity}, live load"] },
  { id: "broker.packet", who: "broker", expect: tool("send_packet"), phrases: ["send me your packet", "email me your W-9 and insurance", "I need your carrier packet to set you up", "can you send your setup paperwork?"] },
  { id: "broker.mc", who: "broker", expect: tool("broker_mc"), phrases: ["our MC is 7 7 7 0 0 1", "we're MC 777001", "my MC number is 555001"] },

  { id: "email.load_offers", who: "email", expect: (r) => r.reading?.kind === "load_offers", subject: "Loads available", phrases: ["Loads this week: {city} to Atlanta, reefer, {money}. Memphis to Dallas van {money}.", "Got a {city} to Houston dry van picking up tomorrow, paying {money}. Interested?", "Hot load: {city} > Chicago, flatbed, {weight} lbs, {money} all in."] },
  { id: "email.rate_reply", who: "email", expect: (r) => r.reading?.kind === "rate_reply", subject: "Re: {ref}", phrases: ["We can do {money} on {ref}.", "Best I have on {ref} is {money}, let me know.", "{money} works for us on {ref}, rate con to follow.", "Can you do {rpm} a mile on {ref}?"] },
  { id: "email.setup", who: "email", expect: (r) => r.reading?.kind === "setup_request", subject: "Carrier setup", phrases: ["Please send your carrier packet so we can set you up.", "Need your W-9 and COI to get you onboarded.", "Before we book, we need your setup paperwork."] },
  { id: "email.payment", who: "email", expect: (r) => r.reading?.kind === "payment", subject: "Remittance", phrases: ["We paid invoice INV-{ref} {money} via ACH today.", "Payment sent for {ref}: {money}, check #{seal}.", "Quick pay processed for {ref}, {money} less 2%."] },
  { id: "email.cancel", who: "email", expect: (r) => r.reading?.kind === "cancellation", subject: "{ref} cancelled", phrases: ["Sorry, we are cancelling load {ref}, the shipper pulled it.", "{ref} is cancelled, customer pushed the order.", "Please don't send the truck for {ref}, it's cancelled."] },
  { id: "email.other", who: "email", expect: (r) => r.reading?.kind === "other", subject: "Hello", phrases: ["Happy holidays from all of us at the brokerage!", "Our office will be closed Monday for the holiday.", "Just checking in, how's business?"] },
];

/** A small seeded random number generator, so a run can be repeated. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slotsIn = (p) => [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const fillCount = (p) => slotsIn(p).reduce((n, s) => n * SLOTS[s].length, 1);
const fill = (p, r) => p.replace(/\{(\w+)\}/g, (_, s) => SLOTS[s][Math.floor(r() * SLOTS[s].length)]);

/** How many different messages each intent can produce, and in all. */
export function count() {
  const per = {};
  for (const it of INTENTS) {
    const en = it.phrases.reduce((n, p) => n + fillCount(p), 0) * OPENERS[it.who].length * CLOSERS[it.who].length * NOISE.length;
    const other = Object.values(it.langs ?? {}).flat().reduce((n, p) => n + fillCount(p), 0) * NOISE.length;
    per[it.id] = en + other;
  }
  return { per, total: Object.values(per).reduce((a, b) => a + b, 0) };
}

/** n messages, spread evenly over the intents (optionally only some), each with what the AI should do. */
export function sample(n, seed = 1, only = null) {
  const r = rng(seed);
  const intents = INTENTS.filter((it) => !only || only.some((o) => it.id.startsWith(o)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const it = intents[i % intents.length];
    const langs = Object.entries(it.langs ?? {});
    const foreign = langs.length && r() < 0.2;
    const [lang, list] = foreign ? langs[Math.floor(r() * langs.length)] : ["en", it.phrases];
    let text = fill(list[Math.floor(r() * list.length)], r);
    if (!foreign) text = OPENERS[it.who][Math.floor(r() * OPENERS[it.who].length)] + text + CLOSERS[it.who][Math.floor(r() * CLOSERS[it.who].length)];
    const [noise, apply] = NOISE[Math.floor(r() * NOISE.length)];
    out.push({ intent: it.id, who: it.who, lang, noise, text: apply(text, r), subject: it.subject ? fill(it.subject, r) : undefined, expect: it.expect });
  }
  return out;
}
