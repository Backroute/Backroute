/**
 * A job on another company's website, as the app and the owner see it. The worker (portal-worker/) drives the
 * browser; the app decides each step (lib/portal/step) and what happens when it's done (lib/portal/tasks).
 */

export type PortalKind = "sign_rate_con" | "carrier_setup" | "dock_appointment";
export type PortalStatus = "queued" | "running" | "needs_approval" | "needs_answer" | "needs_code" | "done" | "failed" | "cancelled";

export const PORTAL_KIND_LABEL: Record<PortalKind, string> = {
  sign_rate_con: "Sign the rate con",
  carrier_setup: "Carrier setup",
  dock_appointment: "Dock appointment",
};

/** One thing the AI did on the page (values it typed from the vault are never kept). */
export interface PortalStepLog {
  at: string;
  url: string;
  action: string;
  target?: string;
  value?: string;
  ok?: boolean;
  error?: string;
  note?: string;
  final?: boolean;
}

export interface PortalTaskData {
  /** Who asked for it: the broker's email, their name, and what the email said. */
  from?: string;
  fromName?: string;
  brokerId?: string;
  subject?: string;
  /** Which stop (dock appointments). */
  stop?: "pickup" | "delivery";
  /** The rate con for this load already came as a PDF and matched: the portal copy is the same document. */
  verified?: boolean;
  steps?: PortalStepLog[];
  /** The owner said yes to the final submit (or it's within their rules). */
  approvedAt?: string;
  approvedBy?: string;
  /** What the AI wants to submit, and the screenshot of it, while it waits for the owner. */
  pending?: { what: string; screenshotId?: string; element?: number; at: string };
  /** A question for the owner (something the website asks that the AI doesn't know), and the answer's key. */
  question?: { text: string; key: string; at: string; secret?: boolean };
  /** A code the website sent (by email to the carrier's AI address), sealed until the worker types it. */
  code?: { sealed: string; at: string; from: string };
  codeAskedAt?: string;
  /** How it ended. */
  note?: string;
  screenshots?: string[];
  signedFileId?: string;
  appointment?: { local: string; iso?: string; confirmation?: string | null };
  /** The escalation raised for it, if any. */
  escalationId?: string;
  /** The worker let go of it while waiting on the owner; it starts over from the link once they answer. */
  parked?: boolean;
  /** Where the AI opened an account for the carrier (a setup network), saved to the vault. */
  opened?: string;
}

export interface PortalTask {
  id: string;
  carrier_id: string;
  kind: PortalKind;
  status: PortalStatus;
  url: string;
  load_id: string | null;
  data: PortalTaskData;
  attempts: number;
  worker: string | null;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

/** What the owner's screens get: no step values, just what happened. */
export interface PortalTaskView {
  id: string;
  kind: PortalKind;
  status: PortalStatus;
  site: string;
  loadId: string | null;
  loadRef?: string;
  question?: string;
  secretAnswer?: boolean;
  pending?: string;
  note?: string;
  screenshotId?: string;
  steps: number;
  createdAt: string;
  updatedAt: string;
}
