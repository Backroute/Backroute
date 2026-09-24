import type { CallPack } from "./pack";

const hour = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
const s = (n: number) => (n === 1 ? "" : "s");
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const en: CallPack = {
  hour,
  duration: (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`),

  option: (o) => {
    const home = !o.home
      ? ""
      : o.home.kind === "tonight"
        ? " You're home tonight."
        : o.home.kind === "late"
          ? " It runs late, so you'd get home late."
          : o.home.kind === "near"
            ? " It delivers right by home."
            : ` Leaves you about ${o.home.hours} hours from home.`;
    return `${o.origin} to ${o.dest}, ${o.miles} miles, picks up ${o.day}. You'd make about $${o.pay.toLocaleString()} on this ${o.move ? "move" : "load"}.${home}`;
  },
  emptyAt: (kind, city) => (kind === "after" ? `after you deliver in ${city}` : `in ${city}`),
  nextOpen: (name, emptyAt, option, count) =>
    `Hey ${name}, it's your AI dispatcher. Got a load for you ${emptyAt}. ${option}${count > 1 ? ` That's the best of ${count} I found.` : ""} Want it?`,
  nextMore: (option) => `Next one: ${option}`,
  booking: (origin, dest) => `Done. Booking ${origin} to ${dest}. I'll text you the pickup details once the rate con's signed. Changed your mind? Say cancel in the next few seconds.`,
  gone: "That one's gone. Let me look again and call you back.",
  cancelledLoad: "Cancelled, nothing's booked. The options are still on your Home screen, and I'll check back in about 30 minutes. Loads go fast, so don't wait too long.",
  later: "No problem. They're on your Home screen whenever you're ready. Loads go fast, so I'll check back in about 30 minutes.",
  byeLoad: "You got it. Drive safe.",

  numberKind: { pickup: "Pickup number", delivery: "Delivery number", container: "Container number" },
  numberLine: (kind, spoken) => `${kind} is ${spoken}.`,
  pickupNotes: [
    "Check in at the guard shack with that number and they'll give you a door",
    "Trucks go in through the back gate off the service road, not the front lot",
    "It's a live load, about two hours. Your detention clock starts at check-in",
    "Shipping office is on the left as you pull in. They want your seal number on the BOL",
  ],
  deliveryNotes: [
    "Receiving is around the back. Call-in is on the sign at the gate",
    "They're strict on appointments, so check in 15 minutes early",
    "They unload, you wait in the truck. Get the POD signed before you pull off",
    "No overnight parking on site, so don't show up early the night before",
  ],
  apptAt: (h) => `Your appointment is ${h}`,
  apptTomorrow7: "Your appointment is tomorrow at 7 AM",
  apptWindow: (a, b) => `They load between ${a} and ${b}`,
  briefOpen: (p) =>
    `Hey ${p.name}, quick one before you get there. You're about ${p.eta} from ${p.place} in ${p.city}. ${p.numberLine} ${p.note}. ${p.appt}, and I already told the broker you're close. I texted you all of this.`,
  repeatNumber: (line) => `${line} It's in your texts too.`,
  lumper: (a) => `If they want a lumper, the broker covers up to $${a}. Pay with the fleet card, get a receipt, and snap it in the app. I'll bill it back.`,
  driveSafe: "Drive safe.",

  lateOpen: (p) =>
    `Heads up, ${p.name}. There's a wreck on ${p.road} ahead, adds about ${p.delay} minutes. I already called the receiver in ${p.city} and moved your appointment from ${p.was} to ${p.now}, and told the broker. Nothing for you to do.`,
  route: "I don't have a better route than your truck GPS. Going around this one adds more miles than it saves, so staying on it is still faster.",

  stop: (brand, exit) => `the ${brand} at exit ${exit}`,
  parkOpen: (p) =>
    `${p.name}, you've got ${p.hours < 1 ? "under an hour" : `about ${p.hours} hours`} of driving left and ${p.miles} miles to go, so you won't make the receiver today. I already moved your delivery to tomorrow at 7 AM and told the broker. ${p.stop.charAt(0).toUpperCase() + p.stop.slice(1)}, ${p.ahead} miles ahead, takes reservations, $${p.cost} for the night. Want me to book you a spot? Lots around there fill up by 7.`,
  reserved: (stop) => `Booked. The spot's under your company name at ${stop}, on the fleet card. Say cancel if you'd rather not.`,
  parkCancelled: "Cancelled, no spot booked. Don't leave it too late, those lots fill up.",
  parkOwn: "OK. Don't leave it too late, those lots fill up. Delivery's still tomorrow at 7.",
  restUp: "Rest up. Talk tomorrow.",

  setupOpen: (name) => `Hi ${name}, it's your AI dispatcher. Three quick questions so I only call when it's worth it. First, what's the earliest I can call you?`,
  setupQ2: (said) => `Got it, ${said}. And I never call while you're in the sleeper or off duty; I text instead. Any states you won't run to?`,
  setupQ3: (said) => `${said.charAt(0).toUpperCase() + said.slice(1)}. Last one. When I find your next loads, do you want a call, or just a text?`,
  setupDone: (items) => `All set. ${items.join(". ")}. You can change any of it in your Profile. Drive safe.`,
  prefSaid: {
    "early:6": "I won't call before 6 AM",
    "early:8": "I won't call before 8 AM",
    "early:any": "I'll call any time you're on duty",
    "avoid:NJ": "I'll keep you out of New Jersey and the city",
    "avoid:CA": "I'll keep you out of California",
    "avoid:none": "I'll send you anywhere that pays",
    "loads:call": "I'll call you with new loads",
    "loads:text": "I'll text you new loads instead of calling",
  },
  prefLine: {
    noCallsBefore: (h) => `No calls before ${h}`,
    anyTime: "Calls any time you're on duty",
    noLoadsInto: (states) => `No loads into ${states.join(" or ")}`,
    anyState: "Loads into any state",
    loadsText: "New loads by text",
    loadsCall: "New loads by phone call",
  },
  stateName: { NJ: "New Jersey", CA: "California" },

  inOpen: (name) => `Hey ${name}, it's dispatch. What do you need?`,
  bookedDesc: (o) => `${o.origin} to ${o.dest}, ${o.miles} miles, picks up ${o.day}`,
  inBooked: (desc) => `Your next load's already booked: ${desc}. Details are on your Home screen.`,
  inOptions: (count, emptyAt, option) => `I've got ${count > 1 ? `${count} options` : "one"} for you ${emptyAt}. Best one: ${option} Want it?`,
  inNothing: "Nothing booked yet. I'm working the boards now and I'll call you the moment I have something good.",
  bdQ: "OK. First, are you off the road and safe?",
  bdSafe: "Good. I'm on it: finding the nearest shop that can come to you, and telling the broker the load's delayed. Flashers on, triangles out. I'll call you back with the ETA.",
  bdDanger: "If anyone's hurt, hang up and call 911 first. I'm getting someone from the office on it right now, and I've started on a tow and a shop.",
  lateQ: "How late are you going to be?",
  lateAmount: { 30: "about 30 minutes", 60: "about an hour", 120: "two hours or more" },
  lateConfirm: (a) => `Got it, ${a}. I'm telling the receiver and the broker now and asking to move your appointment. I'll text you the new time. Drive safe.`,
  pay: (pay, n) => `So far this week you've made ${pay} on ${n} load${s(n)}. It's paid on your company's normal settlement day. I texted you the breakdown.`,
  payNone: "Nothing's settled for this week yet. Your pay shows up in Earnings as soon as a load delivers.",
  inBye: "Anytime. Drive safe.",

  person: "Sure. I'm getting someone from the office to call you back, usually within 10 minutes. Anything we already set up stays as is.",
  personSupport: "Sure. I'm getting a Backroute support specialist to call you back, usually within 10 minutes. Anything we already set up stays as is.",
  sorry: "Sorry, I didn't catch that.",
  saidAgain: "Say that again?",
  saidPerson: "Can I talk to a person?",
  ownerJoined: (name, owner) => `${name}, ${owner} from the office just joined. I'll let you two talk and keep notes.`,

  ch: {
    bookIt: "Book it", bookThis: "Book this one", whatElse: "What else?", bookFirst: "Book the first one", notNow: "Not now", cancelThat: "Cancel that", thanksBye: "Thanks, bye",
    sayNumber: "Say the number again", lumperQ: "What if there's a lumper?", gotIt: "Got it, thanks", goAround: "Should I go around?", okThanks: "OK, thanks",
    bookSpot: "Book the spot", findOwn: "I'll find my own",
    early6: "6 AM", early8: "8 AM", earlyAny: "Any time", avoidNJ: "No New Jersey or NYC", avoidCA: "No California", avoidNone: "I'll go anywhere", loadsCall: "Call me", loadsText: "Just text me",
    myNext: "My next load", brokeDown: "I broke down", runningLate: "I'm running late", myPay: "My pay", thanks: "Thanks",
    safeYes: "Yes, I'm safe", dangerNo: "No, I need help now", late30: "About 30 minutes", late60: "About an hour", late120: "Two hours or more",
    soundsGood: "Sounds good", holdOn: "Hold on a sec",
  },

  txt: {
    booked: (short) => `Booked from our call: ${short}. Pickup details come once the rate con is signed.`,
    options: (emptyAt, list) => `Load options ${emptyAt}:\n${list.map((x, i) => `${i + 1}. ${x}`).join("\n")}\nPick one on your Home screen.`,
    brief: (p) => `${p.pickup ? "Pickup" : "Delivery"}: ${p.place}, ${p.city}\n${p.numberKind}: ${p.number}\n${p.appt}\n${p.note}.`,
    late: (p) => `Your ${p.city} appointment moved from ${p.was} to ${p.now} (wreck on ${p.road}). The broker knows.`,
    parkReserved: (p) => `Parking reserved: ${p.stop}, ${p.ahead} mi ahead, $${p.cost} on the fleet card. Delivery moved to tomorrow 7 AM.`,
    parkNot: (p) => `You're out of hours before the receiver. Delivery moved to tomorrow 7 AM. ${p.stop}, ${p.ahead} mi ahead, takes reservations ($${p.cost}).`,
    setup: "Your call settings are saved. Change them any time in Profile.",
    inPay: (pay, n) => `Your pay this week so far: ${pay} on ${n} load${s(n)}. Full breakdown in Earnings.`,
    inBreakdown: "Breakdown logged. The AI is finding a shop and has told the broker. Stay with the truck; the ETA comes by call and text.",
    inLate: (a) => `Logged: running ${a} late. The receiver and broker are being told; your new appointment time comes by text.`,
    inGeneric: "From your call with dispatch: question answered.",
    autoBooked: (p) => `Booked your next load: ${p.origin} → ${p.dest}, ${p.miles} mi, picks up ${p.pickup}. Details in the app.`,
  },

  words: {
    numbers: [["one", "first", "1"], ["two", "second", "2"], ["three", "third", "3"], ["four", "fourth", "4"]],
    again: ["again", "repeat", "say that", "what was that", "come again"],
    person: ["person", "human", "someone", "somebody", "real", "office"],
    hangup: ["hang up", "goodbye"],
  },

  quick: {
    oneMore: "Can you take one more load today before heading home?",
    callWhenParked: "Call me when you're parked, no rush.",
    callBack: "Let me check on that and call you back in 10 minutes.",
    thanks: "Thanks, you're doing great. Drive safe.",
  },

  owner: {
    greetFleet: "AI Dispatcher. What do you need on your fleet?",
    greetLoad: (o, d, b) => `Calling about the ${o} → ${d} load with ${b}. What do you need me to push on?`,
    ack: {
      rate: (b) => `On it. Taking that back to ${b} right now, I'll confirm the second they answer.`,
      detention: (b) => `Got it. I'm asking ${b} to confirm detention and lumper terms on this one.`,
      schedule: (b) => `Understood. Checking with ${b} on flexibility for the pickup window.`,
      payment: (b) => `On it. Asking ${b} about quick pay on this load.`,
      general: "Got it. I'll flag that with the broker now.",
    },
    quickFleet: ["What needs my attention?", "How's net profit looking?", "How many trucks are available?", "Any DOT inspections due?"],
    quickLoad: ["Push for a better rate", "Ask about detention pay", "Ask about the pickup window", "Ask about quick pay terms"],
  },

  daily: (p) =>
    [
      `${p.carrier}, ${WEEKDAY[p.weekday]}: ${p.delivered} load${s(p.delivered)} delivered, ${p.profit} profit.`,
      p.rolling ? `${p.rolling} truck${s(p.rolling)} still rolling tonight.` : "All trucks parked for the night.",
      p.asks ? `${p.asks} thing${p.asks === 1 ? " needs" : "s need"} you${p.firstAsk ? `, first: ${p.firstAsk.charAt(0).toLowerCase()}${p.firstAsk.slice(1)}` : ""}.` : "Nothing needs you.",
      "Details: backroute.app/today",
    ].join(" "),
};
