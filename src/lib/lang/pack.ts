import type { DispatchCallOption, Lang } from "../types";

export interface LangInfo {
  code: Lang;
  /** The language's own name, as the driver would pick it. */
  native: string;
  english: string;
  /** BCP-47 tag for the phone's speech voice and recognizer. */
  speech: string;
}

/** The languages most spoken by drivers and owners across the US and Canada after English. */
export const LANGS: LangInfo[] = [
  { code: "en", native: "English", english: "English", speech: "en-US" },
  { code: "es", native: "Español", english: "Spanish", speech: "es-US" },
  { code: "pa", native: "ਪੰਜਾਬੀ", english: "Punjabi", speech: "pa-IN" },
  { code: "hi", native: "हिन्दी", english: "Hindi", speech: "hi-IN" },
  { code: "ru", native: "Русский", english: "Russian", speech: "ru-RU" },
  { code: "uk", native: "Українська", english: "Ukrainian", speech: "uk-UA" },
  { code: "fr", native: "Français", english: "French", speech: "fr-CA" },
];

export const LANG_INFO = Object.fromEntries(LANGS.map((l) => [l.code, l])) as Record<Lang, LangInfo>;

export type PrefKey = "early:6" | "early:8" | "early:any" | "avoid:NJ" | "avoid:CA" | "avoid:none" | "loads:call" | "loads:text";
export type NumberKind = "pickup" | "delivery" | "container";
export type QuickPhrase = "oneMore" | "callWhenParked" | "callBack" | "thanks";

/** Every word the AI dispatcher says to a driver, in one language. Facts (cities, numbers, money) come in as values;
 *  each language puts them in its own order. */
export interface CallPack {
  hour(h: number): string;
  duration(mins: number): string;

  // Next load
  option(o: DispatchCallOption): string;
  emptyAt(kind: "after" | "in", city: string): string;
  nextOpen(name: string, emptyAt: string, option: string, count: number): string;
  nextMore(option: string): string;
  booking(origin: string, dest: string): string;
  gone: string;
  cancelledLoad: string;
  later: string;
  byeLoad: string;

  // Pickup and delivery briefs
  numberKind: Record<NumberKind, string>;
  numberLine(kind: string, spoken: string): string;
  pickupNotes: string[];
  deliveryNotes: string[];
  apptAt(hour: string): string;
  apptTomorrow7: string;
  apptWindow(from: string, to: string): string;
  briefOpen(p: { name: string; eta: string; place: string; city: string; numberLine: string; note: string; appt: string }): string;
  repeatNumber(numberLine: string): string;
  lumper(amount: number): string;
  driveSafe: string;

  // Late appointment
  lateOpen(p: { name: string; road: string; delay: number; city: string; was: string; now: string }): string;
  route: string;

  // Hours and parking
  stop(brand: string, exit: number): string;
  parkOpen(p: { name: string; hours: number; miles: number; stop: string; ahead: number; cost: number }): string;
  reserved(stop: string): string;
  parkCancelled: string;
  parkOwn: string;
  restUp: string;

  // Setup
  setupOpen(name: string): string;
  setupQ2(said: string): string;
  setupQ3(said: string): string;
  setupDone(items: string[]): string;
  prefSaid: Record<PrefKey, string>;
  prefLine: { noCallsBefore(hour: string): string; anyTime: string; noLoadsInto(states: string[]): string; anyState: string; loadsText: string; loadsCall: string };
  stateName: Record<string, string>;

  // Driver calls in
  inOpen(name: string): string;
  bookedDesc(o: { origin: string; dest: string; miles: number; day: "today" | "tomorrow" }): string;
  inBooked(desc: string): string;
  inOptions(count: number, emptyAt: string, option: string): string;
  inNothing: string;
  bdQ: string;
  bdSafe: string;
  bdDanger: string;
  lateQ: string;
  lateAmount: Record<30 | 60 | 120, string>;
  lateConfirm(amount: string): string;
  pay(pay: string, loads: number): string;
  payNone: string;
  inBye: string;

  // Always
  person: string;
  /** "Get me a person" for an owner-operator: no office, so Backroute Support calls back. */
  personSupport: string;
  sorry: string;
  saidAgain: string;
  saidPerson: string;
  ownerJoined(name: string, owner: string): string;

  ch: {
    bookIt: string; bookThis: string; whatElse: string; bookFirst: string; notNow: string; cancelThat: string; thanksBye: string;
    sayNumber: string; lumperQ: string; gotIt: string; goAround: string; okThanks: string; bookSpot: string; findOwn: string;
    early6: string; early8: string; earlyAny: string; avoidNJ: string; avoidCA: string; avoidNone: string; loadsCall: string; loadsText: string;
    myNext: string; brokeDown: string; runningLate: string; myPay: string; thanks: string; safeYes: string; dangerNo: string;
    late30: string; late60: string; late120: string; soundsGood: string; holdOn: string;
  };

  txt: {
    booked(short: string): string;
    options(emptyAt: string, list: string[]): string;
    brief(p: { pickup: boolean; place: string; city: string; numberKind: string; number: string; appt: string; note: string }): string;
    late(p: { city: string; was: string; now: string; road: string }): string;
    parkReserved(p: { stop: string; ahead: number; cost: number }): string;
    parkNot(p: { stop: string; ahead: number; cost: number }): string;
    setup: string;
    inPay(pay: string, loads: number): string;
    inBreakdown: string;
    inLate(amount: string): string;
    inGeneric: string;
    autoBooked(p: { origin: string; dest: string; miles: number; pickup: string }): string;
  };

  /** Words that pick a choice by voice: the numbers one to four, then the three that always work. */
  words: { numbers: string[][]; again: string[]; person: string[]; hangup: string[] };

  /** What the owner can say on a call they took over, said to the driver in the driver's language. */
  quick: Record<QuickPhrase, string>;

  /** The owner calling the AI: about the fleet, or about one load's negotiation. The quick asks line up with the
   *  English instructions the engine acts on, so a tapped ask works in any language. */
  owner: {
    greetFleet: string;
    greetLoad(origin: string, dest: string, broker: string): string;
    ack: { rate(broker: string): string; detention(broker: string): string; schedule(broker: string): string; payment(broker: string): string; general: string };
    quickFleet: [string, string, string, string];
    quickLoad: [string, string, string, string];
  };

  /** The owner's end-of-day text. */
  daily(p: { carrier: string; weekday: number; delivered: number; profit: string; rolling: number; asks: number; firstAsk?: string }): string;
}
