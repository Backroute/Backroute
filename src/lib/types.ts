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

export type EquipmentType = "Dry Van" | "Reefer" | "Flatbed";

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
}

export interface Lane {
  origin: string;
  originState: string;
  destination: string;
  destState: string;
  miles: number;
  marketRpm: number;
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
  homeTimeTarget: string;
  /** Driver Settlement AI: how weekly pay is computed. */
  payType: "percentage" | "per_mile";
  payRate: number;
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
}

export interface VoiceCall {
  id: string;
  status: "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer";
  startedAt: string;
  durationSec: number;
  transcript: CallTranscriptLine[];
  outcome?: string;
}

export interface LoadDocument {
  id: string;
  type: "rate_confirmation" | "bol" | "pod" | "invoice";
  name: string;
  generatedAt: string;
  status: "pending" | "verified";
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
  documents: LoadDocument[];
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
  | "truck_reassigned";

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
}
