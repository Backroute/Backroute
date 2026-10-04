/** The shape of the app's store: everything the screens read, and every action they can take. */
import type { StoreApi } from "zustand";
import { type OfferAskDraft } from "../engine";
import { type BrokerPolicy } from "../broker-policy";
import { type QuickPhrase } from "../lang";
import { type FleetEntry, type NewLoad } from "../fleet";
import type { Advance, FuelTx, PayRun, TollTx, RateConPdfReading, ActivityEvent, Broker, Carrier, CarrierMessage, DispatchCall, Driver, DriverMessage, DriverPrefs, HosStatus, DvirInspection, DvirItem, Escalation, Expense, TimeOffRequest, Incident, IncidentType, Load, RunType, MaintenanceAppointment, Truck, VoiceCall } from "../types";
import type { AgentSettings, Autonomy } from "./settings";

export type DriverDocType = "bol" | "pod" | "lumper_receipt";

export interface LiveMetrics {
  activeCalls: number;
  activeSmsThreads: number;
  activeEmailThreads: number;
  loadsScannedToday: number;
  boardsConnected: number;
}

/**
 * Who this browser is signed in as. "demo" is the built-in sample fleet with nothing saved. "office" is an owner or
 * dispatcher: this browser runs the AI and saves the fleet. "driver" sees and answers only their own things.
 * `driverId` is the driver this person is (drivers and owner-operators).
 */
export interface CloudSession {
  /** "books": a bookkeeper's session (sees the money and the fleet, keeps the books, doesn't dispatch). */
  mode: "demo" | "office" | "driver" | "books";
  carrierId?: string;
  driverId?: string | null;
  /** A carrier with nothing saved yet: starts from the fleet read at sign-up, and the AI sources its first offers. */
  fresh?: boolean;
}

export interface StoreState {
  carriers: Carrier[];
  brokers: Broker[];
  trucks: Truck[];
  drivers: Driver[];
  loads: Load[];
  activity: ActivityEvent[];
  escalations: Escalation[];
  driverMessages: DriverMessage[];
  carrierMessages: CarrierMessage[];
  incidents: Incident[];
  maintenanceAppointments: MaintenanceAppointment[];
  dvirInspections: DvirInspection[];
  timeOffRequests: TimeOffRequest[];
  expenses: Expense[];
  /** The back office: fuel card and toll statements, driver pay runs and advances (lib/back-office). */
  fuelTx: FuelTx[];
  tollTx: TollTx[];
  payRuns: PayRun[];
  advances: Advance[];
  /** The AI's phone calls to drivers: ringing, live, held for quiet hours, or done. */
  dispatchCalls: DispatchCall[];
  settings: AgentSettings;
  liveMetrics: LiveMetrics;
  tickCount: number;
  /** Demo, or signed in to a real account (see lib/cloud). */
  session: CloudSession;
  actions: {
    tick: () => void;
    resolveEscalation: (id: string, approve: boolean, actor?: "carrier" | "ops", note?: string) => void;
    routeEscalationToSupport: (id: string) => void;
    sendDriverMessage: (driverId: string, content: string) => void;
    /** Fleet-level chat — the carrier's counterpart to sendDriverMessage. Not tied to any one load;
     *  answers from the carrier's whole book (active loads, net profit, open escalations, fleet status). */
    sendCarrierMessage: (carrierId: string, content: string) => void;
    updateSettings: (partial: Partial<AgentSettings>) => void;
    driverConfirmStage: (loadId: string) => void;
    /** Driver dismissed the "load complete" card — the truck's current (or next-to-pick) load takes over. */
    acknowledgeDelivery: (truckId: string) => void;
    /** Auto-pick on/off for a truck. Turning it on also picks from any options already waiting. */
    setAutoChain: (truckId: string, on: boolean) => void;
    /** Driver ticks off an on-site step at the stop they're at: loaded at pickup, unloaded at delivery. */
    confirmTripStep: (loadId: string, step: "loaded" | "unloaded") => void;
    setSealNumber: (loadId: string, sealNumber: string) => void;
    /** Driver photographs a document at the stop; a moment later the AI has read it and marks it verified
     *  (and for a lumper receipt, files the reimbursement itself). Re-uploading replaces the previous one. */
    uploadLoadDocument: (loadId: string, type: DriverDocType, file: { name: string; previewUrl?: string; file?: File }) => void;
    recaptureDocument: (loadId: string, type: "bol" | "pod") => void;
    selectLoadOffer: (offerGroupId: string, loadId: string, actor: "driver" | "carrier") => void;
    reportIncident: (driverId: string, truckId: string, type: IncidentType, note: string) => void;
    /** Kicks off the formal insurance claim for an accident — separate from the automated incident-
     *  response steps, which just handle getting everyone safe and the load moving again. */
    startClaim: (incidentId: string) => void;
    /** Books a shop appointment and takes the truck out of the offer pool immediately (in-shop) rather
     *  than waiting for the appointment date — a scheduled truck isn't one the AI should still be booking. */
    scheduleMaintenance: (truckId: string, shopName: string, serviceType: string, scheduledFor: string) => void;
    /** Marks the appointment done, returns the truck to available, and resets the service-interval baseline. */
    completeMaintenance: (truckId: string) => void;
    /** Logs a pre-trip or post-trip DVIR. A defect on any item routes it to Escalations, same as
     *  anything else this app can flag but not resolve on its own. */
    submitDvir: (driverId: string, truckId: string, kind: "pre_trip" | "post_trip", items: DvirItem[], notes?: string) => void;
    /** Always a human call — the carrier approves or denies, never the AI. */
    requestTimeOff: (driverId: string, startDate: string, endDate: string, reason: string) => void;
    respondTimeOff: (id: string, approve: boolean) => void;
    /** Out-of-pocket cost a driver fronted on the road, submitted for reimbursement. Same human-only
     *  approval pattern as time off — this is the driver's own money, not the load's economics. */
    submitExpense: (driverId: string, loadId: string | null, category: Expense["category"], amount: number, note: string) => void;
    respondExpense: (id: string, approve: boolean) => void;
    /** Checks off one intermediate stop on a multi-stop load. Doesn't touch load.stage — the overall
     *  pickup/transit/delivery lifecycle still runs off the existing stage machine untouched. */
    completeLoadStop: (loadId: string, stopId: string) => void;
    seedInitialOffers: () => void;
    /** Long-haul targets ("Home in 2 weeks") also set the date this run is due to end. */
    updateHomeTimeTarget: (driverId: string, target: string) => void;
    /** Local, regional or long haul. Changing it drops any waiting offers that no longer fit so the AI re-sources. */
    setRunType: (driverId: string, runType: RunType) => void;
    requestBetterRate: (loadId: string, actor: "driver" | "carrier", amount?: number) => void;
    /** Keeps the real AI's reading of an uploaded rate con on the load, and logs what it found. */
    saveRateConReading: (loadId: string, reading: RateConPdfReading) => void;
    /** A real account's sign-up: the fleet the owner typed in replaces the sample fleet, and everything else starts empty. */
    setUpRealFleet: (entries: FleetEntry[]) => Driver[];
    /** Adds trucks and drivers to a real fleet (Fleet page). */
    addToFleet: (entries: FleetEntry[]) => void;
    /** A load the owner booked themselves: typed in or read off its rate con. The broker is added if new. */
    addLoad: (input: Omit<NewLoad, "brokerId"> & { brokerName: string; brokerEmail?: string | null; rateConReading?: RateConPdfReading }) => Load;
    /** Cancels a booked load that's fallen through (broker pulled it, detention refused, etc.). A truck
     *  already dispatched or at pickup earns the broker's TONU fee; earlier than that, no fee applies. */
    cancelLoad: (loadId: string, reason: string) => void;
    /** Walks away from an in-progress negotiation — broker won't move, a better lane came up, whatever.
     *  Nothing's booked yet so there's no TONU; just stops pursuing this one and frees any truck it had
     *  tentatively chained to. */
    declineLoad: (loadId: string, reason: string) => void;
    /** Swaps which truck is running a load — breakdown, driver calls in sick, whatever. Only offered
     *  before the freight is actually moving (booked through at_pickup); frees the old truck back to
     *  available and puts the new one on_load. */
    reassignTruck: (loadId: string, newTruckId: string) => void;
    /** Ask the AI a question about a pending offer before committing — detention, schedule, payment terms, anything but rate (the AI already set that from data; pushing further belongs to post-selection negotiation). Phase one logs the ask and returns what to show; `resolved` true means there's nothing to wait on. */
    requestOfferDetail: (loadId: string, text: string) => { draft: OfferAskDraft; pendingReply: string; resolved: boolean };
    /** Phase two: the broker's actual answer to a non-rate ask. */
    resolveOfferDetail: (loadId: string, draft: OfferAskDraft) => string;
    sendNegotiationInstruction: (loadId: string, actor: "driver" | "carrier", text: string) => void;
    /** Has the AI pick up the phone and close a load that's stuck in email back-and-forth. */
    startBrokerCall: (loadId: string) => void;
    finishBrokerCall: (loadId: string, callId: string) => void;
    /** Persists a driver/carrier voice call about a load once it hangs up, so it shows up in the same call
     *  history as the AI's own calls to brokers — a call is only real if it leaves a record. */
    logLoadVoiceCall: (loadId: string, call: Omit<VoiceCall, "id">) => void;
    setAiPaused: (loadId: string, paused: boolean) => void;
    /** The office sets a dock's street address (the driver's truck GPS goes there). Empty clears it. */
    setDockAddress: (loadId: string, stop: "pickup" | "delivery", address: string) => void;
    opsOverrideRate: (loadId: string, amount: number) => void;
    /** Ops manually re-tiers a broker — after investigating a complaint, a false-positive fraud flag,
     *  whatever the automated score missed. Same "internal action, visible to the carrier" transparency
     *  as the load-level overrides above. */
    opsSetBrokerTier: (brokerId: string, tier: Broker["tier"]) => void;
    /** Internal-only bookmark on a carrier account for follow-up — no carrier-facing effect, no activity
     *  log entry; just something Ops sees when scanning the Carriers table. */
    opsToggleCarrierFlag: (carrierId: string) => void;
    toggleAddon: (addonId: string) => void;
    /** The one autopilot setting: carriers start on "ask" and move up as they trust the AI. */
    setAutonomy: (level: Autonomy) => void;
    /** Carrier overrides the AI's call on a broker (null goes back to the AI's own). Blocking one also stops any
     *  negotiation still open with them; loads already booked stay booked. */
    setBrokerPolicy: (brokerId: string, policy: BrokerPolicy | null) => void;
    /** The carrier logs that they actually talked with a driver — the AI can't do this part. */
    logDriverCheckIn: (driverId: string) => void;
    /** Tells the AI to pick loads that get this driver home before chasing the best rate. */
    setHomePriority: (driverId: string, on: boolean) => void;
    /** The driver picks up an AI dispatch call. */
    answerDispatchCall: (callId: string) => void;
    /** "Later" on a ringing call: nothing is lost, the AI texts the same information. */
    declineDispatchCall: (callId: string) => void;
    /** The driver answers on a live call, by tapping a choice or saying it (`heard`). */
    replyDispatchCall: (callId: string, reply: string, heard?: string) => void;
    hangUpDispatchCall: (callId: string) => void;
    /** Duty status from the ELD (tappable in the demo). Sleeper and off duty hold every AI call. */
    setDutyStatus: (driverId: string, status: HosStatus) => void;
    setDriverPrefs: (driverId: string, prefs: DriverPrefs) => void;
    /** The driver asked the AI to call them and set up how it reaches them. */
    startSetupCall: (driverId: string) => void;
    /** The driver calls dispatch; the AI picks up straight away. */
    startInboundCall: (driverId: string) => void;
    /** The owner steps into a live call: the AI says so and hands over, then just keeps the record. */
    takeOverDispatchCall: (callId: string) => void;
    /** The owner talking on a call they took over. */
    ownerSayOnCall: (callId: string, text: string, quick?: QuickPhrase) => void;
  };
}

export type Actions = StoreState["actions"];
export type SetState = StoreApi<StoreState>["setState"];
export type GetState = StoreApi<StoreState>["getState"];
