/** What the owner sets for the AI: how much it books on its own, and the business details the real version uses. */
import { type BrokerPolicy } from "../broker-policy";
import type { Lang, OwnerRule } from "../types";

export const AUTONOMY_LABEL: Record<Autonomy, string> = { ask: "Ask me first", rules: "Within my rules", full: "Full autopilot" };
export const AUTONOMY_DETAIL: Record<Autonomy, string> = {
  ask: "The AI finds, scores and negotiates. You or the driver pick every load.",
  rules: "The AI books on its own when a load makes money, pays your minimum rate and fits home time. The rest wait for a pick.",
  full: "The AI books every truck's next load the moment it finds the best one.",
};

/** The language the owner reads driver calls in on the dashboard. */
export function readLangOf(settings: Pick<AgentSettings, "ownerLanguage" | "transcriptsIn">): Lang {
  return settings.transcriptsIn === "mine" ? settings.ownerLanguage : "en";
}

export type Aggressiveness = "conservative" | "balanced" | "aggressive";

/** How much the AI books on its own: every pick by a person, anything that clears the carrier's rules, or all of it. */
export type Autonomy = "ask" | "rules" | "full";

export interface AgentSettings {
  /** The date the carrier's insurance certificate (COI) runs out, if no certificate with a date is on file. */
  insuranceExpires?: string;
  /** Real accounts: the lowest rate per loaded mile the AI will ask for or accept from a broker. */
  minRpm?: number;
  /** Real accounts: where brokers send payment questions, and the address that goes on invoices. */
  remitEmail?: string;
  businessAddress?: string;
  /** Real accounts: invoices go to the factoring company instead of the broker when this is set. */
  factoringEmail?: string;
  /** Real accounts: the AI texts drivers before pickup and delivery, and follows up. On unless turned off. */
  checkIns?: boolean;
  autonomy: Autonomy;
  aggressiveness: Aggressiveness;
  autoBookEnabled: boolean;
  autoBookThreshold: number;
  voiceEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  tmsProvider: string;
  tmsConnected: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
  /** The owner's end-of-day summary text. */
  dailyText: boolean;
  /** The language the owner is texted and talked to in: the end-of-day text. */
  ownerLanguage: Lang;
  /** Driver call transcripts on the dashboard: in the dashboard's language (English), or in the owner's own. */
  transcriptsIn: "dashboard" | "mine";
  /** One truck, and the owner drives it: the driver app becomes the whole business — loads, money, approvals. */
  ownerOperator: boolean;
  rateFloorPct: number;
  avoidWatchBrokers: boolean;
  offersPerTruck: number;
  enabledAddons: string[];
  /** Carrier's own call on a broker, overriding what the AI decided from its record. */
  brokerOverrides: Record<string, BrokerPolicy>;
  /** Real accounts: judgment calls the owner lets the AI make without asking. */
  ownerRules?: Partial<Record<OwnerRule, boolean>>;
  /** Real accounts: the most empty miles the AI will drive a truck to a pickup (default 300). */
  maxDeadhead?: number;
  /** Real accounts: the AI's weekly how's-it-going text to each driver. On unless turned off. */
  driverCheckins?: boolean;
  /** Real accounts: check-call emails to the broker every 4 hours on every load, not only when the rate con asks. */
  checkCallEmails?: boolean;
  /** Real accounts: the carrier's profiles on the carrier setup networks brokers use, sent with setup packets. */
  setupProfiles?: { name: string; url: string }[];
  /** Real accounts: a weekly text to each driver with their loads, miles and estimated pay. Off unless turned on. */
  payTexts?: boolean;
  /** Real accounts: the detention the AI asks brokers for, per hour after 2 hours free (default $50). */
  detentionPerHour?: number;
  /** Real accounts: the truck-ordered-not-used fee the AI asks for (default $150). */
  tonuFee?: number;
  /** Real accounts: the carrier hauls hazmat (the AI won't book it otherwise). */
  hazmat?: boolean;
  /** Real accounts: who brokers reach from the carrier's truck posts: the AI's line (default) or the owner. */
  postContact?: "ai" | "owner";
  /**
   * Real accounts: sandbox mode. The AI reads and decides everything as usual, but no text, email or call leaves;
   * each one is kept for the owner to see what it would have sent (a shadow week), or for the simulated brokers and
   * drivers to answer (eval/sim).
   */
  sandbox?: boolean;
  /** Real accounts: who signs rate cons for the carrier, as the owner authorized it (the AI signs matching ones in their name). */
  rateConSigner?: { name: string; title?: string };
  /** Real accounts: pay per extra stop the AI asks for when a broker adds one (default $75). */
  stopPay?: number;
  /** Real accounts: layover pay per day the AI asks for when a truck is held overnight (default $250). */
  layoverPay?: number;
  /** Real accounts: the cargo insurer's claims email, where the AI sends a claim file once the owner OKs it. */
  cargoInsurerEmail?: string;
  /** Real accounts: the lowest broker credit score (0-100) the AI books with when a credit service is connected (default 70). */
  minBrokerCredit?: number;
  /** Real accounts: the AI signs, fills and books on broker websites itself (lib/portal). Off: support does them. */
  portalAi?: boolean;
  /** Real accounts: each driver's morning text with the day's stops, dock tips and weather. On unless turned off. */
  morningBriefs?: boolean;
  /** Real accounts: the owner's one-minute review of the week, Monday mornings. On unless turned off. */
  weeklyReview?: boolean;
  /**
   * Real accounts: seconds an email the AI wrote on its own to book, counter or accept waits before it goes, so the
   * owner can stop it (default 90; 0 sends at once).
   */
  undoSeconds?: number;
  /** Real accounts: the owner's lowest rate per loaded mile on a lane, by "TX>TN" (origin state > destination state). */
  laneFloors?: Record<string, number>;
  /** Real accounts: the weekday drivers are paid, shown on their pay card (default Friday). */
  payDay?: string;
  /**
   * The owner's emergency stop. The AI keeps reading everything and answering drivers, but books nothing, sends
   * nothing to brokers and calls no broker or dock: all of it waits in Needs you until they resume.
   */
  paused?: boolean;
  /** When they paused, to show how long it's been. */
  pausedAt?: string;
}
