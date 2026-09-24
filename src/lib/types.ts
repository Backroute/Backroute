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
  sourced: "Sourced",
  scoring: "Scoring",
  offered: "Awaiting Choice",
  negotiating: "Negotiating",
  rate_confirmed: "Rate Confirmed",
  booked: "Booked",
  dispatched: "Dispatched",
  at_pickup: "At Pickup",
  in_transit: "In Transit",
  at_delivery: "At Delivery",
  delivered: "Delivered",
  declined: "Declined",
  cancelled: "Cancelled",
};

export type Channel = "email" | "sms" | "voice";

/** "Container" is a day cab pulling a container chassis — in-town drayage. */
export type EquipmentType = "Dry Van" | "Reefer" | "Flatbed" | "Container";

export interface Broker {
  id: string;
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
  fraudRisk: "low" | "medium" | "high";
  /** Payment history, from the carrier's own invoices plus the factoring partner's broker credit data. */
  avgDaysToPay: number;
  /** Share of detention claims the broker actually paid. */
  detentionPaidPct: number;
  /** Loads the broker cancelled on carriers after booking, last 90 days. */
  cancellations90d: number;
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
  /** How the driver wants the AI dispatcher to reach them, set on a setup call or in Profile. */
  prefs?: DriverPrefs;
}

export interface DriverPrefs {
  /** Hour of the day (0–23) before which the AI doesn't call; it texts instead. */
  noCallsBefore?: number;
  /** States the driver won't take loads into (e.g. NJ for the NYC area). */
  avoidStates?: string[];
  /** New-load options by phone call, or just a text. */
  newLoads?: "call" | "text";
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
}

/** One checklist item in a DVIR (Driver Vehicle Inspection Report). */
export interface DvirItem {
  label: string;
  status: "ok" | "defect";
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
  /** "pending" while the AI is still reading a driver upload. */
  status: "pending" | "verified";
  uploadedBy?: "driver";
  /** In-session preview of the driver's photo (an object URL, so it doesn't survive a reload). */
  previewUrl?: string;
  /** What the AI pulled out of the document when it checked it. */
  aiNote?: string;
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

export interface Load {
  id: string;
  referenceNumber: string;
  stage: LoadStage;
  source: string;
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
  /** On an offer: hours of driving from where it delivers back to the driver's home. */
  hoursHomeAfter?: number;
  /** On an offer: the whole day — pickup, delivery and the drive home — fits one shift. */
  homeTonight?: boolean;
  /** On an offer: how easy it is to find the next load where this one delivers. */
  reloadMarket?: "strong" | "fair" | "weak";
  /** Extra percentage the AI added to its ask because this broker pays slowly or disputes detention. */
  surchargePct?: number;
  /** Intermediate stops beyond the lane's origin/destination — absent or empty means a normal single-pickup,
   *  single-delivery load, which is most of them. */
  stops?: LoadStop[];
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
}

export interface DriverMessage {
  id: string;
  driverId: string;
  from: "driver" | "ai";
  content: string;
  timestamp: string;
}

/** Fleet-level chat — not tied to any one load, unlike negotiation messages. The carrier's equivalent
 *  of DriverMessage: "how's my week going," "which broker should I avoid," not "push this rate." */
export interface CarrierMessage {
  id: string;
  carrierId: string;
  from: "carrier" | "ai";
  content: string;
  timestamp: string;
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
export type DispatchCallKind = "next_load" | "pickup_brief" | "delivery_brief" | "late_eta" | "hours_parking" | "setup";

export interface DispatchCallChoice {
  label: string;
  /** What the store does with it; `say` is what the driver is heard saying. */
  reply: string;
  say: string;
  /** Loose words that pick this choice when the driver says it out loud. */
  match?: string;
}

/** Something the driver agreed to on the call. It happens when the call ends, so "cancel that" can still undo it. */
export type DispatchCallEffect =
  | { type: "book"; groupId: string; loadId: string }
  | { type: "reserve_parking"; place: string; cost: number }
  | { type: "prefs"; prefs: DriverPrefs };

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
  lines: { speaker: "ai" | "driver"; text: string; at: string }[];
  choices: DispatchCallChoice[];
  /** Where the script is. */
  step: string;
  /** Facts frozen when the call was created: pickup number, door, the options on offer. */
  facts: Record<string, string>;
  options?: { loadId: string; say: string; short: string }[];
  effects: DispatchCallEffect[];
  /** The one-line result shown on the carrier board and in call history. */
  outcome?: string;
  heldReason?: string;
  /** Set once the text copy has gone to the driver's Messages. */
  textedAt?: string;
}
