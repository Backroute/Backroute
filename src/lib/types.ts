export type LoadStage =
  | "sourced"
  | "scoring"
  | "offered"
  | "negotiating"
  | "rate_confirmed"
  | "booked"
  | "dispatched"
  | "at_pickup"
  | "in_transit"
  | "at_delivery"
  | "delivered"
  | "declined"
  | "cancelled";

export const LOAD_STAGE_ORDER: LoadStage[] = [
  "sourced",
  "scoring",
  "offered",
  "negotiating",
  "rate_confirmed",
  "booked",
  "dispatched",
  "at_pickup",
  "in_transit",
  "at_delivery",
  "delivered",
];

export const LOAD_STAGE_LABEL: Record<LoadStage, string> = {
  sourced: "Found",
  scoring: "Checking",
  offered: "Pick one",
  negotiating: "Negotiating",
  rate_confirmed: "Rate agreed",
  booked: "Booked",
  dispatched: "Dispatched",
  at_pickup: "At pickup",
  in_transit: "On the road",
  at_delivery: "At delivery",
  delivered: "Delivered",
  declined: "Passed",
  cancelled: "Cancelled",
};

export type Channel = "email" | "sms" | "voice";

/** "Container" is a day cab pulling a container chassis — in-town drayage. */
export type EquipmentType = "Dry Van" | "Reefer" | "Flatbed" | "Container";

export interface Broker {
  id: string;
  /** Real accounts: the language the broker writes in (ISO code, e.g. "fr"), so our emails go in it too. */
  language?: string;
  /** Set on brokers a carrier added themselves (with a load); the sample brokers have none. */
  carrierId?: string;
  company: string;
  contact: string;
  phone: string;
  email: string;
  reliability: number;
  avgResponseMins: number;
  loadsBooked: number;
  onTimePct: number;
  avgRateVariancePct: number;
  tier: "preferred" | "standard" | "watch";
  /** Broker Shield AI: FMCSA authority check before the AI will negotiate with them. */
  authorityVerified: boolean;
  /** Real accounts: the broker's MC number, and what the FMCSA check found and when. */
  mc?: string;
  legalName?: string;
  verifiedAt?: string;
  verifyNote?: string;
  fraudRisk: "low" | "medium" | "high";
  /** Payment history, from the carrier's own invoices plus the factoring partner's broker credit data. */
  avgDaysToPay: number;
  /** Share of detention claims the broker actually paid. */
  detentionPaidPct: number;
  /** Loads the broker cancelled on carriers after booking, last 90 days. */
  cancellations90d: number;
  /** Real accounts: the broker said they won't deal with an AI on the phone: the AI works with them by email only. */
  noAiCalls?: { at: string; said: string };
  /** Real accounts: the broker's credit, from a credit service and the carrier's own paid invoices (lib/agent/credit). */
  credit?: { score: number | null; daysToPay: number | null; source: string; at: string };
  /** A shipper the carrier hauls for directly (no broker): invoiced on its own terms, with contract lanes. */
  direct?: boolean;
  /** Days the customer has to pay (net 30). */
  terms?: number;
  billingAddress?: string;
  lanes?: ContractLane[];
}

/** Freight a direct shipper has on a schedule: the same lane at the same rate on set days. */
export interface ContractLane {
  id: string;
  origin: string;
  originState: string;
  destination: string;
  destState: string;
  miles: number;
  rate: number;
  equipmentType: EquipmentType;
  /** Pickup weekdays, 0 = Sunday. */
  days: number[];
  /** Pickup time at the shipper, local. */
  pickupTime: string;
  active: boolean;
  /** The last pickup date a load was made for, so each one is made once. */
  madeThrough?: string;
}

export interface Lane {
  origin: string;
  originState: string;
  destination: string;
  destState: string;
  miles: number;
  marketRpm: number;
  /** Set for an in-town move, which pays a flat price per move rather than by the mile. */
  moveKind?: MoveKind;
}

/** An intermediate stop on a multi-stop load — additional pickups or drop-offs between the lane's
 *  origin and destination, which stay the first pickup and final delivery everywhere else in the app
 *  (rate, scoring, IFTA mileage). Purely additive: a load with no stops behaves exactly as before. */
export interface LoadStop {
  id: string;
  kind: "pickup" | "delivery";
  city: string;
  state: string;
  window: string;
  /** 1-based order between origin and destination. */
  sequence: number;
  completed: boolean;
}

export type HosStatus = "driving" | "on_duty" | "off_duty" | "sleeper";

/** How a driver runs, which decides every load the AI books for them: local drivers are home every night and stay
 *  close, regional drivers stay within a day's drive and are home weekends, long-haul drivers go anywhere for weeks. */
export type RunType = "intown" | "local" | "regional" | "otr";

/** In-town work: short moves inside one metro, several a day — containers off the rail ramp or port, empties back,
 *  and runs between warehouses and stores. */
export type MoveKind = "container_pickup" | "empty_return" | "warehouse_transfer" | "store_delivery";

export interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
  truckId: string;
  carrierId: string;
  hosStatus: HosStatus;
  hoursRemaining: number;
  /** Hours left on the 70-hour, 8-day clock (the "recap"), when known. The ELD's `hos.cycle` wins when connected. */
  cycleHoursLeft?: number;
  /** Real accounts with an ELD connected: the driver's hours clocks, and when they were read. */
  hos?: { drive: number; shift: number; cycle: number; at: string; source: "samsara" | "motive" };
  cdl: string;
  rating: number;
  hireDate: string;
  homeBase: string;
  runType: RunType;
  homeTimeTarget: string;
  /** Long haul: the day the driver is due home at the end of this run. */
  homeDueAt?: string;
  /** Driver Settlement AI: how pay is computed. Local drivers are usually paid by the hour. */
  payType: "percentage" | "per_mile" | "hourly" | "per_move";
  payRate: number;
  /** Last time someone at the carrier actually talked with this driver, as logged on the Fleet page. */
  lastCheckInAt?: string;
  /** Carrier told the AI to put getting this driver home ahead of the best-paying load. */
  homePriority?: boolean;
  /** Real accounts: the last time the ELD had the truck at the driver's home. */
  lastHomeAt?: string;
  /** Real accounts: how the driver said things are going, from the weekly check-in or any conversation. */
  care?: { at: string; mood: "good" | "ok" | "bad"; note?: string; homeBy?: string };
  /** How the driver wants the AI dispatcher to reach them, set on a setup call or in Profile. */
  prefs?: DriverPrefs;
  /** The dates their CDL and DOT medical card run out. */
  cdlExpires?: string;
  medCardExpires?: string;
  /** How they're paid for tax: contractors (1099) get a 1099-NEC each January; employees (W-2) are payroll's. */
  taxForm?: "1099" | "w2";
  /** Taken out of each pay run (insurance, ELD, truck lease) unless "once", which comes out of the next one only. */
  deductions?: Deduction[];
  /** Held back each pay run up to a cap and paid back when they leave: per run, the cap, and what's held so far. */
  escrow?: { perRun: number; cap: number; held: number };
}

/** Truck GPS apps only (lib/nav-apps): car apps route trucks onto roads they can't use. */
export type NavApp = "sygic" | "copilot";

export interface Deduction {
  id: string;
  label: string;
  amount: number;
  every: "run" | "once";
}

/** Languages the AI dispatcher speaks with drivers and owners. Brokers are always worked in English. */
export type Lang = "en" | "es" | "pa" | "hi" | "ru" | "uk" | "fr";

/** The same words in other languages, for whoever reads a call in a language other than the one spoken. */
export type Translations = Partial<Record<Lang, string>>;

export interface DriverPrefs {
  /** The language the AI talks and texts in. Many people read an app in English but talk in another language. */
  language?: Lang;
  /** The language the app's screens are in. English unless the driver picks another. */
  appLanguage?: Lang;
  /** Hour of the day (0–23) before which the AI doesn't call; it texts instead. */
  noCallsBefore?: number;
  /** States the driver won't take loads into (e.g. NJ for the NYC area). */
  avoidStates?: string[];
  /** New-load options by phone call, or just a text. */
  newLoads?: "call" | "text";
  /** Where calls and texts go: the app, or a regular phone call and SMS for drivers who won't use an app. */
  reach?: "app" | "phone";
  /** The driver texted STOP to the dispatch number: no texts until they text START. */
  smsOptOut?: boolean;
  /** How the AI texts them: SMS, or WhatsApp (replies to a WhatsApp message go back on WhatsApp either way). */
  textsBy?: "sms" | "whatsapp";
  /** The morning text with the day's stops, times, dock tips and weather. On unless they turn it off. */
  morningBrief?: boolean;
  /** Answers to their voice messages come back as a voice message too (and as text). On unless turned off. */
  voiceReplies?: boolean;
  /** False: notifications in the driver app instead of texts, while their phone takes them (texts again if not). */
  textsToo?: boolean;
  /** Hands-free comes on by itself when the phone is moving at road speed. On unless turned off. */
  handsFreeAuto?: boolean;
  /** The navigation app "Directions" opens. */
  navApp?: NavApp;
  /** Spoken heads-ups as the drive and shift clocks run down. On unless turned off. */
  hosVoice?: boolean;
  /**
   * Real accounts: what the driver has told the AI about themselves (family, health, what they like to run), newest
   * last, the way a good dispatcher remembers. Used in later conversations and when picking their loads.
   */
  notes?: { at: string; text: string; until?: string }[];
}

/** A reservable truck parking spot, from the parking service (lib/agent/parking). */
export interface ParkingSpot {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  /** For the night, in dollars. */
  price: number;
  /** Miles from where the driver's hours run out (or from the truck, with no load). */
  miles?: number;
}

/** A spot the AI reserved because the driver or the owner asked it to. */
export interface ParkingReservation {
  id: string;
  place: string;
  address: string;
  lat: number;
  lon: number;
  price: number;
  arriveAt: string;
  confirmation: string;
  /** How to get in, when the lot gave one (a gate code, which row). */
  checkIn?: string;
  askedBy: "driver" | "owner";
  at: string;
  status: "booked" | "cancelled";
}

export interface Truck {
  id: string;
  unitNumber: string;
  driverId: string | null;
  /** Team driving — a second driver paired on the same truck so it can run further per day (one drives
   *  while the other's in the sleeper). Optional: most trucks run solo. */
  secondDriverId?: string | null;
  carrierId: string;
  equipmentType: EquipmentType;
  status: "available" | "on_load" | "maintenance";
  currentCity: string;
  currentState: string;
  homeBase: string;
  /** Real accounts with an ELD connected: where the truck actually is, and when that was read. */
  position?: { lat: number; lon: number; at: string; description?: string; source: "samsara" | "motive" };
  /** Real accounts: the AI's plan for this truck (now, next, home time), refreshed every dispatch round. */
  plan?: { lines: string[]; at: string };
  /** Real accounts: the AI sent the truck empty toward busier freight; board searches start from there. */
  repositionTo?: { city: string; state: string; at: string };
  /** Real accounts: a breakdown the AI is working on (shops found near the truck, and which one it's calling). */
  roadside?: Roadside;
  /** Real accounts: since when the ELD has had the truck in the same spot (cleared once it moves). */
  stoppedSince?: string;
  /** Real accounts: a truck parking spot the AI reserved, only ever because the driver or the owner asked. */
  parking?: ParkingReservation;
  currentLoadId: string | null;
  nextLoadId: string | null;
  /** A load this truck just delivered that the driver hasn't dismissed yet — keeps the "load complete"
   *  card on screen even though the chained next load has already been promoted into currentLoadId. */
  lastDeliveredLoadId?: string | null;
  /** When on, the AI books the top-scored next load by itself instead of asking the driver/carrier to pick. */
  autoChainNextLoad?: boolean;
  mpg: number;
  odometer: number;
  /** Maintenance AI tracking. */
  lastServiceMiles: number;
  serviceIntervalMiles: number;
  nextInspectionDue: string;
  /** Real accounts with an ELD: when the odometer was last read from it. */
  odometerAt?: string;
  /** Engine fault codes the ELD reported (Samsara, Motive), newest first; cleared ones drop off. */
  faults?: TruckFault[];
  /** Plates and registration (IRP cab card): the date it runs out. */
  registrationExpires?: string;
  /** What truck GPS apps route around: low bridges, weight limits, hazmat tunnels. */
  profile?: TruckProfile;
  /** The trailer's floor and what it can legally carry, for putting partial loads together. Unset: 53 ft (48 ft
   *  flatbed) and 44,000 lbs. */
  trailer?: { feet: number; payloadLbs: number };
  /** Real accounts: several partial loads hauled together on one run (lib/trip-plan): every pickup and drop in the
   *  order the truck makes them. Each load keeps its own rate con and invoice. */
  trip?: Trip;
}

/** One pickup or drop on a multi-load trip. */
export interface TripStop {
  loadId: string;
  kind: "pickup" | "delivery";
}

export interface Trip {
  id: string;
  stops: TripStop[];
  /** A trip planned ahead: the booked load it starts after (the one the truck is on, or one lined up behind it). */
  after?: string;
  /** When the order was last worked out. */
  at: string;
  /** Things the driver should know about the order: a load that has to be moved to get another out (a restack). */
  warnings?: string[];
}

export interface TruckProfile {
  /** Inches: 13'6" is 162. */
  heightIn: number;
  weightLbs: number;
  lengthFt: number;
  hazmat: boolean;
}

export interface TruckFault {
  code: string;
  description: string;
  /** critical: stop and get it looked at (engine derate, oil pressure, coolant); warn: book it in soon. */
  severity: "info" | "warn" | "critical";
  at: string;
  source: "samsara" | "motive" | "manual";
}

export interface RoadsideShop {
  name: string;
  address: string;
  phone: string;
  rating?: number;
  openNow?: boolean;
  miles?: number;
}

export interface Roadside {
  at: string;
  driverId: string;
  loadId?: string;
  details: string;
  where: string;
  shops: RoadsideShop[];
  /** Index of the shop the AI is calling (or last called). */
  calling: number;
  /** The shop that said yes. */
  found?: { shop: string; phone: string; eta: string | null };
  /** Every shop said no or didn't answer. */
  exhausted?: boolean;
  /** The AI moved on to heavy-duty towing after the repair shops. */
  towTried?: boolean;
}

/** One checklist item in a DVIR (Driver Vehicle Inspection Report). */
export interface DvirItem {
  label: string;
  status: "ok" | "defect";
  /** A defect: what's wrong, in the driver's words, and a photo of it (stored, or a preview in the demo). */
  note?: string;
  photoFileId?: string;
  photoPreview?: string;
}

/** FMCSA requires a pre-trip and post-trip inspection report for every driven vehicle. A defect on
 *  any item makes the whole report "defect" — that's what routes it to an escalation, same as any
 *  other thing this app can't resolve without a human call. */
export interface DvirInspection {
  id: string;
  driverId: string;
  truckId: string;
  carrierId: string;
  kind: "pre_trip" | "post_trip";
  items: DvirItem[];
  overallStatus: "pass" | "defect";
  notes?: string;
  createdAt: string;
}

/** A driver's request for time off, routed to the carrier for a yes/no — this is the one thing in the
 *  app that's always a human call, never something the AI can approve on its own. */
export interface TimeOffRequest {
  id: string;
  driverId: string;
  carrierId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  respondedAt?: string;
}

/** An out-of-pocket cost a driver fronted on the road — lumper fee, detention, parking, scale ticket —
 *  submitted for reimbursement. Always a human call on the carrier side, same as time off; the AI
 *  handles the load's own fuel/toll/deadhead costs, but it doesn't touch a driver's own money. */
export interface Expense {
  id: string;
  driverId: string;
  carrierId: string;
  loadId: string | null;
  category: "lumper" | "detention" | "parking" | "scale" | "other";
  amount: number;
  note: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  respondedAt?: string;
  /** Asked for before paying (a lumper at the dock): the owner sends a payment code instead of paying it back later. */
  upfront?: boolean;
  /** The code the driver gives the lumper service (a Comdata or EFS express code, or a card's one-time number). */
  payCode?: string;
  /** Where: the receiver or shipper the lumper is at. */
  facility?: string;
  /** The receipt the driver photographed: stored (real accounts) or a preview on this device (demo). */
  receiptFileId?: string;
  receiptPreview?: string;
}

/** A booked appointment at a repair shop — created by "Schedule at a shop" on the Maintenance page.
 *  Scheduling puts the truck into "maintenance" status immediately (in-shop), which the offer engine
 *  already treats as unavailable, so this doesn't need separate booking logic. */
export interface MaintenanceAppointment {
  id: string;
  truckId: string;
  carrierId: string;
  shopName: string;
  serviceType: string;
  scheduledFor: string;
  status: "scheduled" | "completed";
  createdAt: string;
  completedAt?: string;
}

export interface Carrier {
  id: string;
  name: string;
  mc: string;
  dot: string;
  plan: "Starter" | "Growth" | "Fleet";
  mrr: number;
  trucks: number;
  healthScore: number;
  joinedAt: string;
  city: string;
  state: string;
  takeRateRevenue: number;
  gmvMonth: number;
  avgSavingsPerTruck: number;
  detailed?: boolean;
  /** Ops staff flagged this account for a closer look — a health-score dip, a support ticket, whatever
   *  isn't captured elsewhere. Purely an internal note; carriers never see it. */
  flaggedForReview?: boolean;
}

export interface NegotiationMessage {
  id: string;
  channel: Channel;
  direction: "outbound" | "inbound";
  from: string;
  timestamp: string;
  content: string;
  offerAmount?: number;
}

export interface CallTranscriptLine {
  speaker: "ai" | "broker" | "driver" | "carrier";
  text: string;
  /** The dollar figure this line puts on the table, if any — drives the live rate ticker. */
  offer?: number;
}

/** A broker call the AI is on right now: the whole script is decided up front and plays out in real time
 *  (`atMs` after `startedAt`), so everyone listening hears the same call and it closes the deal when it ends. */
export interface LiveBrokerCall {
  id: string;
  startedAt: string;
  lines: (CallTranscriptLine & { atMs: number })[];
  durationMs: number;
  /** The broker's first number on the call, so the outcome can say how much the AI moved them. */
  openingOffer: number;
  finalRate: number;
}

export interface VoiceCall {
  id: string;
  /** Overrides the default heading in call history, e.g. "AI dispatch call with Marcus". */
  title?: string;
  status: "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer";
  startedAt: string;
  durationSec: number;
  transcript: CallTranscriptLine[];
  outcome?: string;
}

export interface LoadDocument {
  id: string;
  type: "rate_confirmation" | "bol" | "pod" | "invoice" | "lumper_receipt";
  name: string;
  generatedAt: string;
  /** "pending" while the AI is still reading a driver upload; "failed" when it didn't reach the server (retake it). */
  status: "pending" | "verified" | "failed";
  /** Real accounts: the AI saw a problem on it (not signed, the wrong document, a shortage or damage written on it). */
  flagged?: boolean;
  /** Real accounts: the stored file (api/files/[id]). */
  fileId?: string;
  uploadedBy?: "driver";
  /** In-session preview of the driver's photo (an object URL, so it doesn't survive a reload). */
  previewUrl?: string;
  /** What the AI pulled out of the document when it checked it. */
  aiNote?: string;
  /** A lumper receipt: what was paid, read off the receipt. It's billed to the broker on the invoice. */
  amount?: number;
}

/** The driver's on-site checklist for the stop they're at — what they've confirmed and when. */
export interface TripChecklist {
  /** When the driver checked in at the shipper / receiver — starts the dock clock for detention. */
  arrivedPickupAt?: string;
  arrivedDeliveryAt?: string;
  loadedAt?: string;
  unloadedAt?: string;
  sealNumber?: string;
  /** Stops where the AI has already told the broker free time ran out. */
  detentionNoticeSent?: ("pickup" | "delivery")[];
}

/** Extra pay on top of the linehaul the AI claimed from the broker — detention today; lumper, layover, TONU
 *  and the rest follow the same path. */
export interface Accessorial {
  id: string;
  type: "detention";
  stop: "pickup" | "delivery";
  minutes: number;
  amount: number;
  status: "claimed" | "approved";
  createdAt: string;
}

/** One thing on a rate confirmation that doesn't match what was agreed. */
export interface RateConIssue {
  id: string;
  field: "rate" | "detention" | "fines" | "payment" | "pickup" | "mc";
  label: string;
  agreed: string;
  onDoc: string;
  /** Dollars it would cost the carrier if signed as is, when that can be counted. */
  cost: number;
  /** Must be fixed or decided before the load can move; otherwise worth fixing but not a stopper. */
  block: boolean;
  /** open → asked the broker; fixed on a corrected rate con; refused by the broker; accepted by the owner anyway. */
  status: "open" | "fixed" | "refused" | "accepted";
}

/** The AI's read of a load's rate confirmation before it's signed. */
export interface RateConReview {
  /** checking → clean/signed, or fixing (asked the broker) → signed, or needs_you (broker refused / MC mismatch). */
  status: "checking" | "fixing" | "needs_you" | "signed" | "walked";
  startedAt: string;
  askedAt?: string;
  signedAt?: string;
  issues: RateConIssue[];
  escalationId?: string;
}

export interface Load {
  id: string;
  referenceNumber: string;
  stage: LoadStage;
  /** Who picked it from the offers. The driver who picked it themselves doesn't need a call to hear it's booked. */
  pickedBy?: "driver" | "carrier" | "ai";
  /** Team freight: a long run priced for a team truck's faster delivery. */
  teamRate?: boolean;
  source: string;
  /** Real accounts: a finished load from the carrier's own history (Settings, Bring your history), for pricing only. */
  imported?: boolean;
  /** The import it came in with (lib/agent/import-batches), so it can be taken back out. */
  importBatch?: string;
  /** For a rate con read into the history: a fingerprint of the file, so the same one isn't read twice. */
  importHash?: string;
  brokerId: string;
  lane: Lane;
  equipmentType: EquipmentType;
  weight: number;
  pickupWindow: string;
  deliveryWindow: string;
  listedRate: number;
  targetRate: number;
  bookedRate: number | null;
  deadheadMiles: number;
  fuelCost: number;
  tollCost: number;
  deadheadCost: number;
  commission: number;
  netProfit: number | null;
  rpm: number | null;
  score: number;
  carrierId: string;
  truckId: string | null;
  messages: NegotiationMessage[];
  calls: VoiceCall[];
  /** Set while the AI is on the phone with the broker about this load. */
  liveCall?: LiveBrokerCall;
  documents: LoadDocument[];
  tripChecklist?: TripChecklist;
  accessorials?: Accessorial[];
  createdAt: string;
  updatedAt: string;
  isChained: boolean;
  aiConfidence: number;
  ticksInStage: number;
  progressPct: number;
  offerGroupId?: string;
  recommended?: boolean;
  homeTimeFit?: boolean;
  /** Backroute Ops paused the AI on this load — the simulation skips advancing it until resumed. */
  aiPaused?: boolean;
  /** Set once Ops has manually stepped in (rate override, force-book, etc.) so the carrier can see support was involved. */
  opsOverridden?: boolean;
  /** Set when stage is "cancelled" — why the load fell through after being booked. */
  cancellationReason?: string;
  /** Truck-Ordered-Not-Used fee owed by the broker when a truck was already dispatched or at pickup. */
  tonuFee?: number;
  /** Real accounts: what the lane pays now, from the rate data service, when one is connected. */
  market?: { rpm: number; high?: number; source: string };
  /** Real accounts: when the TONU claim went to the broker (it's invoiced after). */
  tonuClaimedAt?: string;
  /** On an offer: hours of driving from where it delivers back to the driver's home. */
  hoursHomeAfter?: number;
  /** On an offer: the whole day — pickup, delivery and the drive home — fits one shift. */
  homeTonight?: boolean;
  /** On an offer: how easy it is to find the next load where this one delivers. */
  reloadMarket?: "strong" | "fair" | "weak";
  /** Extra percentage the AI added to its ask because this broker pays slowly or disputes detention. */
  surchargePct?: number;
  /** The AI's check of the rate confirmation against what was negotiated. Loads wait here until it's signed. */
  rateCon?: RateConReview;
  /** The real AI's reading of a rate con PDF the owner uploaded, checked against what was agreed on this load. */
  rateConReading?: RateConPdfReading;
  /** Real accounts: when the rate con was signed and sent back, and by whom (lib/agent/sign). */
  rateConSignedAt?: string;
  rateConSignedBy?: string;
  /** Real accounts: the broker's tracking app for this load: which, the link if they sent one, and the driver's yes. */
  tracking?: { app: string | null; link: string | null; askedAt: string; acceptedAt?: string };
  /** Real accounts: pickup and delivery appointment times, for check-ins and detention. */
  pickupAt?: string;
  deliveryAt?: string;
  /** What's in the trailer, as the broker said it. */
  commodity?: string;
  hazmat?: boolean;
  /** Appointment times (or first come, first served), as the broker said them on the phone. */
  appointmentNote?: string;
  /** Who at the broker to email about this load (from their email or the rate con). */
  brokerContactEmail?: string;
  /** The AI asked the broker to book this load: the price it asked, and where that stands. */
  bookRequest?: {
    ask: number;
    askedAt: string;
    status: "drafted" | "sent" | "accepted" | "declined";
    countered?: boolean;
    brokerOffer?: number;
    /** The first number we asked; counters come down from it. */
    opening?: number;
    /** How many times we've countered (up to 3). */
    rounds?: number;
    /** The back-and-forth: every number either side named, by email or on the phone. */
    history?: { by: "us" | "them"; amount: number; at: string; via: "email" | "phone" }[];
    /** We walked away (too far under the owner's lowest after three counters), leaving the door open. */
    passedAt?: string;
    /** The owner picked this load and asked for it (not the AI on its own): shown on the load's timeline. */
    byOwner?: boolean;
  };
  /** The broker's email this load came from, so the book request answers it in the same thread. */
  offerEmail?: { subject: string; messageId?: string };
  invoice?: LoadInvoice;
  detentionClaims?: DetentionClaim[];
  /** Real accounts: dock appointments the AI is booking or moving by phone with the shipper or receiver (lib/agent/appointments). */
  appointments?: Partial<Record<"pickup" | "delivery", FacilityAppointment>>;
  /** Layover claims: the truck held overnight at a stop (lib/agent/layover). */
  layoverClaims?: LayoverClaim[];
  /** A change the broker asked for after booking (an added stop, a new delivery), priced by the AI (lib/agent/changes). */
  change?: LoadChange;
  /** A cargo claim (damage, shortage) and the file the AI keeps for it (lib/agent/claims). */
  claim?: CargoClaim;
  /** When the invoice packet went to the factoring company, and what was in it. */
  factoredAt?: string;
  /** Intermediate stops beyond the lane's origin/destination — absent or empty means a normal single-pickup,
   *  single-delivery load, which is most of them. */
  stops?: LoadStop[];
  /** The pickup and delivery docks' street addresses (from the rate con, or typed by the office). Directions go here,
   *  never to the middle of the city. */
  pickupAddress?: string;
  deliveryAddress?: string;
  /** Real accounts: the truck won't make a stop on time (from the ELD): which, the new arrival, when everyone was told. */
  late?: { stop: "pickup" | "delivery"; eta: string; at: string };
  /** Real accounts: why the AI went for this load, or answered the broker the way it did, in plain words (lib/agent/why). */
  why?: { at: string; lines: string[] };
  /** Real accounts: what's wrong with the load's times: a holiday, a dock's hours, not enough hours to drive it (lib/agent/schedule). */
  scheduleWarnings?: ScheduleWarning[];
  /** Real accounts: a reefer load's temperatures, as the driver read them off the unit (lib/agent/reefer). */
  reeferLog?: { at: string; tempF: number; pulp?: boolean; by: "driver" | "photo" }[];
  /** A partial (LTL-sized) load: how much of the trailer it takes. Absent: a full truckload. `stackable` pallets go
   *  two high when they're short enough (`heightIn`), so they take half the floor; "do not stack" takes a spot each. */
  partial?: { feet?: number; pallets?: number; stackable?: boolean; heightIn?: number };
  /** The shipper wants the trailer to itself (exclusive use): nothing rides with it. */
  exclusive?: boolean;
  /** The multi-load trip it rides on (Truck.trip), when it shares the trailer with others. */
  tripId?: string;
  /** One load of a multi-load plan the AI put together and offers as one choice (lib/plans): loads back to back, or
   *  partials sharing the trailer. Every load of the plan carries the same id; booking the plan books them all. */
  plan?: LoadPlan;
}

export type PlanKind = "back_to_back" | "shared_trailer";

export interface LoadPlan {
  id: string;
  kind: PlanKind;
  /** 1-based: the order the loads are hauled in (for a shared trailer, the order they're picked up). */
  leg: number;
  legs: number;
  /** A shared trailer: every pickup and drop in the order the truck makes them. */
  order?: TripStop[];
}

export interface ScheduleWarning {
  /** A problem the load can't be run with as timed (the AI doesn't book it on its own), or one to know about. */
  hard: boolean;
  text: string;
}

/** What a reefer load needs, from the rate con: the set point or range, how the unit runs, pre-cooling. */
export interface ReeferTerms {
  setF: number | null;
  minF: number | null;
  maxF: number | null;
  mode: "continuous" | "cycle" | null;
  preCool: boolean;
}

export type ActivityType =
  | "load_sourced"
  | "scoring_done"
  | "negotiation_email"
  | "negotiation_sms"
  | "call_started"
  | "call_completed"
  | "rate_confirmed"
  | "booked"
  | "tms_synced"
  | "dispatched"
  | "check_call"
  | "document_captured"
  | "delivered"
  | "chained"
  | "escalation"
  | "load_offered"
  | "offer_selected"
  | "incident"
  | "maintenance"
  | "dvir"
  | "load_cancelled"
  | "time_off"
  | "truck_reassigned"
  | "expense";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: ActivityType;
  channel?: Channel;
  message: string;
  detail?: string;
  loadId?: string;
  carrierId?: string;
  severity: "info" | "success" | "warning" | "danger";
}

export interface Escalation {
  id: string;
  loadId: string;
  carrierId: string;
  reason: string;
  createdAt: string;
  /** "with_support" = routed to a human specialist and being actively handled. */
  status: "open" | "with_support" | "resolved";
  /** "routine" cases carry a clear AI recommendation for a one-tap default action; "critical" ones route to human support instead. */
  complexity: "routine" | "critical";
  recommendedAction?: "approve" | "reject";
  /** Human-readable label for the default-action button, e.g. "Approve — send detention invoice". */
  recommendedLabel?: string;
  resolvedBy?: "carrier" | "support" | "ops";
  resolvedAt?: string;
  /** Why Ops said no — captured on reject so a rejected escalation leaves more of a trail than a
   *  vanished card. Approvals don't ask for one; they're the expected outcome, not a decision to explain. */
  resolutionNote?: string;
  /** Set when this approval is a step in an incident the AI is working (e.g. a repair quote). */
  incidentId?: string;
  /** Set when this is a rate con the broker wouldn't correct: approve signs it anyway, reject walks away. */
  rateConLoadId?: string;
  /** A message the AI wrote and wants to send on the carrier's behalf: approve sends it (edited or as is). */
  draft?: DraftMessage;
  /** The AI noticed the owner keeps approving this kind of email unchanged, and offers to stop asking. */
  suggestRule?: OwnerRule;
  /** A yes/no the AI acts on once the owner answers (lib/agent/decisions): yes does it, no leaves it. */
  decision?: { kind: "reposition"; truckId: string; city: string; state: string; miles: number; doneAt?: string };
  /** How the owner answered a yes/no: true for yes. */
  approved?: boolean;
  /** A two-way call the owner answers right on the card (a broker under the floor: "Take it" or "Walk away").
   *  Yes resolves it approved, no resolves it declined; what each does depends on the escalation. */
  answers?: { yes: string; no: string };
  /** Where this came from, when it arrived by a real channel. */
  source?: MessageChannel;
  /** The person on Backroute's support team who took it. */
  supportAssignee?: string;
  /** About a broker (e.g. one the AI couldn't verify), not a load. */
  brokerId?: string;
  /** About a job on another company's website (lib/portal): the owner approves the submit or answers its question. */
  portalTaskId?: string;
}

/** How a message reached Backroute or left it: the app itself, or a real text, call or email. */
export type MessageChannel = "app" | Channel;

export interface DraftMessage {
  channel: "email" | "sms";
  to: string;
  toName?: string;
  subject?: string;
  body: string;
  /** The email this answers, so the reply lands in the same thread. */
  inReplyTo?: string;
  sentAt?: string;
  /** What it's for: a reply the AI wrote, or one of the dispatcher's standard emails (written from a template). */
  purpose?: DraftPurpose;
  /** The price it names, for a book request, counter or acceptance. */
  amount?: number;
  /** Stored files that go with it (the invoice, the POD, the carrier's setup papers). */
  attachments?: { fileId: string; name: string }[];
  /** The owner rule that would have let this go without asking (see OwnerRule). */
  rule?: OwnerRule;
  /** The owner changed the wording before sending. */
  edited?: boolean;
}

/**
 * Judgment calls the owner can hand to the AI once they trust it with them. Off until the owner turns one on (in
 * Settings, or by saying yes when the AI notices they keep approving the same thing unchanged).
 */
export type OwnerRule = "tonu_default" | "detention_default" | "invoice_noted_pod" | "replies" | "portal_setup" | "reposition";

export type DraftPurpose = "reply" | "book_request" | "counter" | "accept" | "setup_packet" | "invoice" | "detention" | "layover" | "change" | "claim" | "factoring" | "payment_reminder" | "tonu" | "eta_update" | "capacity" | "pass" | "ack";

export interface DriverMessage {
  id: string;
  driverId: string;
  /** "owner": written by the owner (or a dispatcher) in the office, not the AI. */
  from: "driver" | "ai" | "owner";
  content: string;
  timestamp: string;
  /** Answered by the real AI (Claude) rather than the scripted demo replies. */
  ai?: boolean;
  /** Came in or went out by text or on a call, not in the app. */
  channel?: MessageChannel;
  /** Written by a person on Backroute's support team, not the AI. */
  bySupport?: string;
  /** Who in the office wrote it ("the office" when the app doesn't know their name). */
  byOwner?: string;
}

/** Fleet-level chat — not tied to any one load, unlike negotiation messages. The carrier's equivalent
 *  of DriverMessage: "how's my week going," "which broker should I avoid," not "push this rate." */
export interface CarrierMessage {
  id: string;
  carrierId: string;
  from: "carrier" | "ai";
  content: string;
  timestamp: string;
  /** Answered by the real AI (Claude) rather than the scripted demo replies. */
  ai?: boolean;
}

export type IncidentType = "breakdown" | "accident" | "delay" | "weather";

export interface IncidentStep {
  label: string;
  status: "pending" | "done";
  timestamp?: string;
  /** The specifics the AI found or did: the shop, the new ETA, the backup truck. */
  detail?: string;
  /** "human" steps wait for the carrier's OK (an escalation) instead of the AI finishing them itself. */
  owner?: "ai" | "human";
}

export interface Incident {
  id: string;
  driverId: string;
  carrierId: string;
  truckId: string;
  loadId: string | null;
  type: IncidentType;
  note: string;
  createdAt: string;
  status: "active" | "resolved";
  steps: IncidentStep[];
  humanNotified: boolean;
  /** The approval request raised when the plan reached a step only a human can sign off on. */
  escalationId?: string;
  /** Formal insurance claim, kicked off from Compliance — separate from the automated incident-response
   *  steps above, which just get everyone safe and moving again. */
  claimStartedAt?: string;
}

/** Why the AI dispatcher is calling a driver — the calls a human dispatcher makes all day. */
export type DispatchCallKind = "next_load" | "pickup_brief" | "delivery_brief" | "late_eta" | "hours_parking" | "setup" | "inbound" | "update";

export interface DispatchCallChoice {
  label: string;
  /** What the store does with it; `say` is what the driver is heard saying. */
  reply: string;
  say: string;
  /** Loose words that pick this choice when the driver says it out loud (English). */
  match?: string;
  /** The button in other languages: the driver's app language, the owner's reading language. */
  tr?: Translations;
}

/** A load the AI reads out on a call, kept as facts so it can be said in any language. */
export interface DispatchCallOption {
  loadId: string;
  /** "Dallas → Memphis, $1,450" — the same in every language. */
  short: string;
  origin: string;
  dest: string;
  miles: number;
  day: "today" | "tomorrow";
  /** What the driver makes on it. */
  pay: number;
  /** An in-town move rather than a load. */
  move: boolean;
  home?: { kind: "tonight" | "late" | "near" | "hours"; hours?: number };
}

/** Something the driver agreed to on the call. It happens when the call ends, so "cancel that" can still undo it. */
export type DispatchCallEffect =
  | { type: "book"; groupId: string; loadId: string }
  | { type: "reserve_parking"; place: string; cost: number }
  | { type: "prefs"; prefs: DriverPrefs };

/** Something a driver reported on a call that the AI starts working the moment it's said, not at hang-up. */
export interface DispatchCallReport {
  incident?: { type: "breakdown" | "delay"; note: string };
  /** Raise it to a person at the carrier, with why. */
  person?: string;
}

/**
 * One AI-to-driver phone call, shared by everyone: the driver's phone rings, the carrier watches it live on the
 * dashboard, and whatever gets agreed updates the load, the offers and both apps when it hangs up. A text copy of
 * anything with a number in it lands in the driver's Messages so nothing has to be written down while driving.
 */
export interface DispatchCall {
  id: string;
  driverId: string;
  carrierId: string;
  loadId?: string;
  kind: DispatchCallKind;
  /** held = the driver is in the sleeper, off duty or inside their no-calls hours; it rings when that ends. */
  status: "queued" | "held" | "ringing" | "live" | "done" | "missed" | "dropped";
  createdAt: string;
  ringingAt?: string;
  answeredAt?: string;
  endedAt?: string;
  /** The driver's language, which the whole call is in. */
  lang: Lang;
  /** `text` is what was said, in the call's language; `tr` is the same line for readers of other languages. */
  lines: { speaker: "ai" | "driver" | "owner"; text: string; at: string; tr?: Translations }[];
  /** Where it rang: the app, or the driver's regular phone. */
  channel?: "app" | "phone";
  /** The carrier's owner took the call over from the AI (listening in is silent and needs no flag). */
  ownerTookOver?: boolean;
  choices: DispatchCallChoice[];
  /** Where the script is. */
  step: string;
  /** Facts frozen when the call was created: pickup number, door, the options on offer. */
  facts: Record<string, string>;
  options?: DispatchCallOption[];
  effects: DispatchCallEffect[];
  /** The one-line result shown on the carrier board and in call history. */
  outcome?: string;
  heldReason?: string;
  /** Set once the text copy has gone to the driver's Messages. */
  textedAt?: string;
  /** Which try this is: a missed call is called back (2), and once more (3), while it still matters. */
  attempt?: number;
  /** Don't ring before this: a call back waits a few minutes, the way a dispatcher tries again. */
  notBefore?: string;
}

/** What the real AI read on an uploaded rate con, and where it differs from the agreed terms. */
export interface RateConPdfReading {
  fileName: string;
  readAt: string;
  isRateCon: boolean;
  broker: string | null;
  brokerMc: string | null;
  brokerEmail?: string | null;
  loadNumber: string | null;
  totalRate: number | null;
  originCity?: string | null;
  originState?: string | null;
  destinationCity?: string | null;
  destinationState?: string | null;
  miles?: number | null;
  pickup: string | null;
  delivery: string | null;
  pickupLocal?: string | null;
  deliveryLocal?: string | null;
  equipment: string | null;
  detention: string | null;
  paymentTerms: string | null;
  /** The shipper and receiver names on the rate con: the AI remembers how long each keeps trucks. */
  shipper?: string | null;
  receiver?: string | null;
  /** The facilities' phone numbers, and a stop still waiting on an appointment the carrier has to book. */
  shipperPhone?: string | null;
  receiverPhone?: string | null;
  shipperZip?: string | null;
  receiverZip?: string | null;
  /** The docks' street addresses, as printed: where the driver's truck GPS takes them. */
  shipperAddress?: string | null;
  receiverAddress?: string | null;
  appointmentNeeded?: "pickup" | "delivery" | "both" | "none";
  /** A refrigerated load's temperature terms, when the rate con has them. */
  reefer?: ReeferTerms | null;
  finesAndFees: string[];
  mismatches: { item: string; agreed: string; onDoc: string; serious: boolean }[];
  otherConcerns: string[];
  summary: string;
}

/** The follow-ups the AI dispatcher sends drivers on its own, each at most once per load. */
export type CheckinKind =
  | "before_pickup"
  | "pickup_late"
  | "pickup_silent"
  | "before_delivery"
  | "delivery_late"
  | "delivery_silent"
  | "pod_needed"
  | "pod_silent";

export interface LoadInvoice {
  number: string;
  amount: number;
  /** What the amount is made of: line haul, then detention, lumper or TONU. */
  lines?: { label: string; amount: number }[];
  draftedAt: string;
  sentAt?: string;
  sentTo?: string;
  paidAt?: string;
  /** What the broker actually paid, when they said (it can be short). */
  paidAmount?: number;
  /** Payment reminders sent, oldest first. */
  remindedAt?: string[];
}

export interface FacilityAppointment {
  /** Book a time the rate con says to call for, or move one the truck will miss. */
  purpose: "book" | "move";
  /** "broker": the facility can't be reached or won't set it by phone, so the broker was asked to (and chased). */
  status: "needed" | "calling" | "set" | "broker" | "failed";
  /** When the broker was asked, and reminded. */
  brokerAskedAt?: string;
  brokerRemindedAt?: string;
  /** For a move: when the truck will really get there (ISO). */
  eta?: string;
  tries: number;
  lastCallAt?: string;
  /** The time the facility gave (ISO) and their confirmation number. */
  at?: string;
  confirmation?: string;
  /** Why it failed, when it did. */
  note?: string;
}

export interface LayoverClaim {
  stop: "pickup" | "delivery";
  days: number;
  amount: number;
  draftedAt: string;
  sentAt?: string;
}

export interface LoadChange {
  kind: "add_stop" | "reroute";
  /** The new stops, or the new delivery for a reroute. */
  places: { city: string; state: string }[];
  extraMiles: number;
  /** What the change pays on top of the rate, and the new all-in total. */
  extra: number;
  newTotal: number;
  askedAt: string;
  status: "asked" | "agreed" | "declined";
  agreedAt?: string;
}

export interface CargoClaim {
  openedAt: string;
  /** Who raised it: the broker or shipper in writing, or the AI from a POD with exceptions. */
  source: "broker" | "pod";
  kind: "damage" | "shortage" | "loss" | "other";
  amount?: number;
  details: string;
  /** Claimant's email, for the acknowledgment and what they still need to send. */
  claimant?: string;
  ackSentAt?: string;
  statementAskedAt?: string;
  statement?: string;
  packetFileId?: string;
  packetAt?: string;
  insurerSentAt?: string;
}

export interface DetentionClaim {
  stop: "pickup" | "delivery";
  minutes: number;
  amount: number;
  draftedAt: string;
  sentAt?: string;
}


// ─── Back office: fuel and tolls, driver pay ─────────────────────────────────

/** A fuel card transaction (WEX, Comdata, EFS...), from an imported statement, matched to the load it fueled. */
export interface FuelTx {
  id: string;
  carrierId: string;
  /** Day of the purchase, yyyy-mm-dd. */
  date: string;
  truckId: string | null;
  /** The unit or card as the statement shows it. */
  unit: string;
  merchant: string;
  city: string;
  state: string;
  gallons: number;
  amount: number;
  product: "diesel" | "def" | "reefer" | "other";
  loadId: string | null;
  importedAt: string;
}

/** A toll (transponder or plate), matched to the load that ran that road. */
export interface TollTx {
  id: string;
  carrierId: string;
  date: string;
  truckId: string | null;
  unit: string;
  agency: string;
  plaza: string;
  state: string;
  amount: number;
  loadId: string | null;
  importedAt: string;
}

/** A driver's pay for one week: the loads, what's added and taken out, and whether it's been paid. */
export interface PayRun {
  id: string;
  carrierId: string;
  driverId: string;
  /** Monday of the week, yyyy-mm-dd, and the Sunday it ends. */
  period: string;
  periodEnd: string;
  lines: { loadId: string; ref: string; lane: string; pay: number }[];
  /** Reimbursed (lumpers, scales) and extra pay (detention, layover). */
  extras: { label: string; amount: number }[];
  gross: number;
  deductions: { label: string; amount: number }[];
  advances: { id: string; amount: number }[];
  escrow: number;
  net: number;
  status: "draft" | "paid";
  paidAt?: string;
  createdAt: string;
}

/** Money paid to a driver ahead of their pay run, taken back out of the next one. */
export interface Advance {
  id: string;
  carrierId: string;
  driverId: string;
  amount: number;
  note: string;
  at: string;
  /** The pay run it came out of. */
  repaidIn?: string;
}
