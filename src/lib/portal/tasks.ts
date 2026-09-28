import "server-only";
import type { Item } from "../cloud/rows";
import type { Escalation, Load } from "../types";
import { addActivity, admin, claimMark, loadContext, save, storeFile, type CarrierContext } from "../agent/db";
import { event, passToOwner, tellOwner, uid } from "../agent/dispatcher";
import { sendOrQueue } from "../agent/outbox";
import { forCarrier } from "../agent/scope";
import * as mail from "../agent/templates";
import { setAppointment } from "../agent/appointments";
import { stopLocalToIso } from "../stop-time";
import { siteOf, vaultConfigured } from "./vault";
import { PORTAL_KIND_LABEL, type PortalKind, type PortalStatus, type PortalTask, type PortalTaskData, type PortalTaskView } from "./types";

/**
 * Jobs on other companies' websites, done by the AI through the browser worker (portal-worker/): sign a rate con in
 * DocuSign or the broker's portal, fill a broker's carrier setup, book a dock appointment on a scheduling site.
 *
 * The app keeps the queue and decides every step (lib/portal/step); the worker only clicks and types. What's binding
 * (the signature, the final submit) goes ahead on its own only when it's safe to: a rate con whose rate matches what
 * was agreed, an appointment inside the load's window, a setup on full autopilot. Anything else waits for the owner's
 * yes. When the website beats the AI (it breaks, or asks for something nobody gave it), support does it, with what
 * the AI saw.
 */

export const OPEN_STATUSES: PortalStatus[] = ["queued", "running", "needs_approval", "needs_answer", "needs_code"];
const MAX_ATTEMPTS = 3;
const WORKER_QUIET_MINUTES = 20;

/** The worker is set up: its secret, and the vault key for the logins it uses. */
export const portalReady = () => Boolean(process.env.PORTAL_WORKER_SECRET) && vaultConfigured();
/** …and this carrier's owner switched it on (Settings → Broker websites). Until then support does these. */
export const portalOn = (ctx: CarrierContext) => portalReady() && ctx.settings.portalAi === true;

// ─── Links in emails ─────────────────────────────────────────────────────────

const urls = (text: string) => [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));

/** Signing sites and where a broker's own "accept the load" link lives. */
const SIGNING_HOSTS = /(^|\.)(docusign\.(net|com)|echosign\.com|adobesign\.com|documents\.adobe\.com|hellosign\.com|dropboxsign\.com|pandadoc\.com|signnow\.com|rightsignature\.com|zohosign\.com|sign\.zoho\.com)$/i;
/** Carrier setup networks brokers use. */
export const SETUP_HOSTS = /(^|\.)(mycarrierpackets\.com|rmis\.com|registrymonitoring\.com|highway\.com|carrierassure\.com|carrier411\.com|carrierok\.com|truckertools\.com|assure\.com|carriersource\.io|mycarrierportal\.com)$/i;
/** Dock scheduling sites. */
export const DOCK_HOSTS = /(^|\.)(opendock\.com|c3reservations\.com|c3solutions\.com|dockscheduler\.com|fourkites\.com|e2open\.com|retalix\.com|ncr\.com|dataDocks\.com|datadocks\.com|velostics\.com|yardview\.com)$/i;

/** The link to sign at: a signing site first, otherwise a link whose words say sign or accept. */
export function signingLink(text: string): string | null {
  const all = urls(text);
  const onSite = all.find((u) => SIGNING_HOSTS.test(siteOf(u) ?? ""));
  if (onSite) return onSite;
  return all.find((u) => /sign|accept|confirm|rate-?con|tender|load/i.test(u) && !/unsubscribe|privacy|logo|\.(png|jpe?g|gif)$/i.test(u)) ?? null;
}

export const setupLink = (text: string) => urls(text).find((u) => SETUP_HOSTS.test(siteOf(u) ?? "")) ?? null;
export const dockLink = (text: string) => urls(text).find((u) => DOCK_HOSTS.test(siteOf(u) ?? "")) ?? null;

// ─── The queue ───────────────────────────────────────────────────────────────

export async function taskById(id: string): Promise<PortalTask | null> {
  const { data, error } = await admin().from("portal_tasks").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as PortalTask | null) ?? null;
}

export async function tasksFor(carrierId: string, limit = 30): Promise<PortalTask[]> {
  const { data, error } = await admin().from("portal_tasks").select("*").eq("carrier_id", carrierId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as PortalTask[];
}

/** Saves what changed (status, lease, data merged into what's there). */
export async function updateTask(task: PortalTask, patch: Partial<Pick<PortalTask, "status" | "worker" | "locked_until" | "url" | "attempts">>, data: Partial<PortalTaskData> = {}): Promise<PortalTask> {
  const next: PortalTask = { ...task, ...patch, data: { ...task.data, ...data }, updated_at: new Date().toISOString() };
  const { error } = await admin()
    .from("portal_tasks")
    .update({ status: next.status, worker: next.worker, locked_until: next.locked_until, url: next.url, attempts: next.attempts, data: next.data, updated_at: next.updated_at })
    .eq("id", task.id);
  if (error) throw error;
  return next;
}

/**
 * Puts a job on the queue for the worker. The same job for the same load (or the same setup link) isn't queued twice
 * while one is still going. Returns the job, or null when the link isn't one the worker should open.
 */
export async function queuePortalTask(ctx: CarrierContext, t: { kind: PortalKind; url: string; loadId?: string | null; data?: PortalTaskData }): Promise<PortalTask | null> {
  const site = siteOf(t.url);
  // Real websites only over https (PORTAL_ALLOW_HTTP is for the test stand-ins).
  if (!site || !(/^https:\/\//i.test(t.url) || (process.env.PORTAL_ALLOW_HTTP === "1" && /^http:\/\//i.test(t.url)))) return null;
  let q = admin().from("portal_tasks").select("*").eq("carrier_id", ctx.carrier.id).eq("kind", t.kind).in("status", [...OPEN_STATUSES, "done"]);
  q = t.loadId ? q.eq("load_id", t.loadId) : q.eq("url", t.url);
  if (t.kind === "dock_appointment" && t.data?.stop) q = q.eq("data->>stop", t.data.stop);
  const { data: existing } = await q.order("created_at", { ascending: false }).limit(1);
  const same = existing?.[0] as PortalTask | undefined;
  // A rate con already signed there, or a job still going: nothing new.
  if (same && (same.status !== "done" || t.kind !== "carrier_setup")) return same;
  const task: PortalTask = {
    id: uid("web"),
    carrier_id: ctx.carrier.id,
    kind: t.kind,
    status: "queued",
    url: t.url,
    load_id: t.loadId ?? null,
    data: { ...(t.data ?? {}), steps: [] },
    attempts: 0,
    worker: null,
    locked_until: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin().from("portal_tasks").insert(task);
  if (error) throw error;
  const load = ctx.loads.find((l) => l.id === t.loadId);
  await addActivity(ctx.carrier.id, event({ type: "document_captured", loadId: load?.id, message: `${PORTAL_KIND_LABEL[t.kind]}${load ? ` for ${load.referenceNumber}` : ""} on ${site}: the AI is doing it on their website`, detail: t.url.slice(0, 200), severity: "info" }));
  return task;
}

/** The worker asks for its next job. Jobs that already failed too often go to support instead. */
export async function claimNext(worker: string, leaseSeconds = 300): Promise<PortalTask | null> {
  for (let i = 0; i < 5; i++) {
    const { data, error } = await admin().rpc("claim_portal_task", { p_worker: worker, p_lease_seconds: leaseSeconds });
    if (error) throw error;
    const task = ((data ?? []) as PortalTask[])[0];
    if (!task) return null;
    if (task.attempts > MAX_ATTEMPTS) {
      await giveUpOn(task, `the website didn't work after ${MAX_ATTEMPTS} tries`);
      continue;
    }
    return task;
  }
  return null;
}

/** Holds the job for the worker a while longer. */
export const extendLease = (task: PortalTask, seconds = 300) => updateTask(task, { locked_until: new Date(Date.now() + seconds * 1000).toISOString() });

// ─── When it's done ──────────────────────────────────────────────────────────

const loadOf = (ctx: CarrierContext, task: PortalTask) => (task.load_id ? ctx.loads.find((l) => l.id === task.load_id) : undefined);
const hostOf = (task: PortalTask) => siteOf(task.url) ?? "their website";

/** The worker finished: signed, set up, booked. What that means for the load and who hears. */
export async function completeTask(task: PortalTask, r: { note?: string; screenshotId?: string; download?: { name: string; contentType: string; bytes: Buffer } }): Promise<PortalTask> {
  return forCarrier(task.carrier_id, async () => {
    const ctx = await loadContext(task.carrier_id);
    if (!ctx) return task;
    const at = new Date().toISOString();
    const load = loadOf(ctx, task);
    const shots = [...(task.data.screenshots ?? []), ...(r.screenshotId ? [r.screenshotId] : [])];
    let signedFileId: string | undefined;
    if (task.kind === "sign_rate_con" && load) {
      const signer = ctx.settings.rateConSigner?.name ?? "the carrier";
      if (r.download && r.download.contentType === "application/pdf" && r.download.bytes.length < 10 * 1024 * 1024)
        signedFileId = await storeFile(ctx.carrier.id, { kind: "rate_con_signed", name: `${load.referenceNumber || "rate-con"}-signed.pdf`.replace(/[^\w.-]+/g, "-"), contentType: "application/pdf", bytes: r.download.bytes, loadId: load.id, note: `Signed on ${hostOf(task)} by ${signer}` });
      const signed: Load = { ...load, rateConSignedAt: at, rateConSignedBy: signer, updatedAt: at };
      await save("loads", ctx.carrier.id, signed as unknown as Item);
      await addActivity(ctx.carrier.id, event({ type: "rate_confirmed", loadId: load.id, message: `Rate con for ${load.referenceNumber} signed on ${hostOf(task)}`, detail: `Signed as ${signer}${r.note ? ` · ${r.note}` : ""}`, severity: "success" }));
    } else if (task.kind === "carrier_setup") {
      await addActivity(ctx.carrier.id, event({ type: "document_captured", message: `Carrier setup done on ${hostOf(task)}${task.data.fromName ? ` for ${task.data.fromName}` : ""}`, detail: r.note, severity: "success" }));
      // The network goes on the carrier's setup profiles, so later packets point brokers to it.
      const site = hostOf(task);
      const profiles = ctx.settings.setupProfiles ?? [];
      if (SETUP_HOSTS.test(site) && !profiles.some((p) => (siteOf(p.url) ?? "").endsWith(site))) {
        const settings = { ...ctx.carrier.settings, setupProfiles: [...profiles, { name: site, url: `https://${site}` }] };
        await admin().from("carriers").update({ settings }).eq("id", ctx.carrier.id);
      }
    } else if (task.kind === "dock_appointment" && load && task.data.stop) {
      const a = task.data.appointment;
      const state = task.data.stop === "pickup" ? load.lane.originState : load.lane.destState;
      const iso = a?.iso ?? (a?.local ? stopLocalToIso(a.local, state) : null);
      if (iso) await setAppointment(ctx, load, task.data.stop, iso, a?.confirmation ?? null, "portal");
    }
    const done = await updateTask(task, { status: "done", locked_until: null }, { note: r.note, screenshots: shots, ...(signedFileId ? { signedFileId } : {}), pending: undefined, question: undefined, code: undefined });
    await closeEscalation(ctx, done, "Done on the website");
    return done;
  });
}

/** Stopped on purpose: the rate con in their portal isn't what was agreed. The broker is asked to fix it. */
export async function mismatch(task: PortalTask, what: string, screenshotId?: string): Promise<PortalTask> {
  return forCarrier(task.carrier_id, async () => {
    const ctx = await loadContext(task.carrier_id);
    const stopped = await updateTask(task, { status: "failed", locked_until: null }, { note: `Not signed: ${what}`, screenshots: [...(task.data.screenshots ?? []), ...(screenshotId ? [screenshotId] : [])] });
    if (!ctx) return stopped;
    const load = loadOf(ctx, task);
    if (load && task.data.from && (await claimMark(ctx.carrier.id, load.id, "portal_mismatch")))
      await sendOrQueue(ctx, { purpose: "ack", to: task.data.from, toName: task.data.fromName, subject: `Re: ${task.data.subject ?? load.referenceNumber}`, body: mail.rateConFix(ctx.carrier, ctx.settings, load, [what], task.data.fromName), loadId: load.id, withinRules: true, why: `Ask ${task.data.fromName ?? "the broker"} to fix the rate con in their portal for ${load.referenceNumber}?` });
    await passToOwner(ctx, { reason: `The AI didn't sign the rate con for ${load?.referenceNumber ?? "a load"} on ${hostOf(task)}: ${what}. It asked the broker to correct it.`, loadId: load?.id, label: "Got it", source: "email", to: "decider", portalTaskId: task.id });
    return stopped;
  });
}

/** Cancelled by the owner. */
export async function cancelTask(task: PortalTask, by: string): Promise<PortalTask> {
  const ctx = await loadContext(task.carrier_id);
  const stopped = await updateTask(task, { status: "cancelled", locked_until: null }, { note: `Stopped by ${by}`, pending: undefined, question: undefined });
  if (ctx) await closeEscalation(ctx, stopped, "Stopped");
  return stopped;
}

/**
 * The website beat the AI. A rate con: the broker is asked for it as a PDF (which the AI signs itself) before
 * anyone else is bothered. Otherwise support does it by hand, with what the AI got through and its last screenshot.
 */
export async function giveUpOn(task: PortalTask, why: string, screenshotId?: string): Promise<PortalTask> {
  return forCarrier(task.carrier_id, async () => {
    const failed = await updateTask(task, { status: "failed", locked_until: null }, { note: why, screenshots: [...(task.data.screenshots ?? []), ...(screenshotId ? [screenshotId] : [])] });
    const ctx = await loadContext(task.carrier_id);
    if (!ctx) return failed;
    await closeEscalation(ctx, failed, "Handed to support");
    const load = loadOf(ctx, task);
    if (task.kind === "sign_rate_con" && load && task.data.from && (await claimMark(ctx.carrier.id, load.id, "portal_pdf_ask"))) {
      await sendOrQueue(ctx, { purpose: "ack", to: task.data.from, toName: task.data.fromName, subject: `Re: ${task.data.subject ?? load.referenceNumber}`, body: `Hi${task.data.fromName ? ` ${task.data.fromName.split(" ")[0]}` : ""},\n\nCould you email the rate con for ${load.referenceNumber} as a PDF? We sign and send it straight back.\n\nThanks,\n${ctx.carrier.name}`, loadId: load.id, withinRules: true, why: `Ask ${task.data.fromName ?? "the broker"} for the rate con as a PDF?` });
      return failed;
    }
    const did = (task.data.steps ?? []).filter((s) => s.ok !== false && s.action !== "wait").length;
    await passToOwner(ctx, {
      reason: `${PORTAL_KIND_LABEL[task.kind]}${load ? ` for ${load.referenceNumber}` : ""} on ${hostOf(task)}: the AI couldn't finish it (${why}). ${did ? `It got ${did} step${did === 1 ? "" : "s"} in; ` : ""}open ${task.url} and finish it with the carrier's details and papers in Settings.`,
      loadId: load?.id,
      label: "Done",
      source: "email",
      to: "support",
      portalTaskId: task.id,
    });
    return failed;
  });
}

/** The owner's item for this job, if any, marked done. */
async function closeEscalation(ctx: CarrierContext, task: PortalTask, note: string) {
  const open = ctx.escalations.filter((e) => e.portalTaskId === task.id && e.status === "open");
  for (const e of open) {
    const resolved: Escalation = { ...e, status: "resolved", resolvedBy: "carrier", resolvedAt: new Date().toISOString(), resolutionNote: note };
    await save("escalations", ctx.carrier.id, resolved as unknown as Item);
  }
}

// ─── Waiting on the owner ────────────────────────────────────────────────────

/** The final submit needs the owner's yes: they see what the AI is about to submit, and the page. */
export async function askApproval(task: PortalTask, what: string, screenshotId: string | undefined, element: number | undefined): Promise<PortalTask> {
  return forCarrier(task.carrier_id, async () => {
    const waiting = await updateTask(task, { status: "needs_approval" }, { pending: { what, screenshotId, element, at: new Date().toISOString() } });
    const ctx = await loadContext(task.carrier_id);
    if (!ctx || ctx.escalations.some((e) => e.portalTaskId === task.id && e.status === "open")) return waiting;
    const load = loadOf(ctx, task);
    const e = await passToOwner(ctx, { reason: `On ${hostOf(task)}: ${what} Submit it?`, loadId: load?.id, label: "Submit", source: "email", to: "owner", portalTaskId: task.id });
    return updateTask(waiting, {}, { escalationId: e.id });
  });
}

/** Something the website asks that the AI doesn't know: one question to the owner, whose answer is kept for next time. */
export async function askOwner(task: PortalTask, question: string, key: string, secret: boolean, screenshotId?: string): Promise<PortalTask> {
  return forCarrier(task.carrier_id, async () => {
    const waiting = await updateTask(task, { status: "needs_answer" }, { question: { text: question, key, at: new Date().toISOString(), secret }, screenshots: [...(task.data.screenshots ?? []), ...(screenshotId ? [screenshotId] : [])] });
    const ctx = await loadContext(task.carrier_id);
    if (!ctx) return waiting;
    const load = loadOf(ctx, task);
    const e = await passToOwner(ctx, { reason: `${hostOf(task)} asks: ${question} Answer here and the AI finishes ${PORTAL_KIND_LABEL[task.kind].toLowerCase()}${load ? ` for ${load.referenceNumber}` : ""}; it keeps the answer for next time.`, loadId: load?.id, label: "Answer", source: "email", to: "owner", portalTaskId: task.id });
    return updateTask(waiting, {}, { escalationId: e.id });
  });
}

/** The owner said yes (or answered): the worker carries on, or starts over from the link if it let go. */
export async function resume(task: PortalTask, data: Partial<PortalTaskData>): Promise<PortalTask> {
  const held = task.worker && task.locked_until && Date.parse(task.locked_until) > Date.now() && !task.data.parked;
  // Starting over after the owner answered isn't a failed try.
  const next = await updateTask(task, held ? { status: "running" } : { status: "queued", worker: null, locked_until: null, attempts: 0 }, { ...data, question: undefined, parked: false });
  const ctx = await loadContext(task.carrier_id);
  if (ctx) await closeEscalation(ctx, next, "Answered");
  return next;
}

// ─── The owner's view ────────────────────────────────────────────────────────

export function viewOf(task: PortalTask, loads: Load[]): PortalTaskView {
  const load = loads.find((l) => l.id === task.load_id);
  const shots = task.data.screenshots ?? [];
  return {
    id: task.id,
    kind: task.kind,
    status: task.status,
    site: hostOf(task),
    loadId: task.load_id,
    loadRef: load?.referenceNumber,
    question: task.status === "needs_answer" ? task.data.question?.text : undefined,
    secretAnswer: task.data.question?.secret,
    pending: task.status === "needs_approval" ? task.data.pending?.what : undefined,
    note: task.data.note,
    screenshotId: task.data.pending?.screenshotId ?? shots[shots.length - 1],
    steps: (task.data.steps ?? []).length,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

// ─── Rounds ──────────────────────────────────────────────────────────────────

/**
 * Every round: a job nobody picked up (the worker is down) goes to support, as our own system failing; a question or
 * approval the owner left for a day gets one reminder in the activity log; a code that never came is asked of the owner.
 */
export async function portalRounds(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  const { data } = await admin().from("portal_tasks").select("*").eq("carrier_id", ctx.carrier.id).in("status", OPEN_STATUSES).limit(50);
  for (const task of (data ?? []) as PortalTask[]) {
    const age = now - Date.parse(task.updated_at);
    if (task.status === "queued" && age > WORKER_QUIET_MINUTES * 60_000) {
      await giveUpOn(task, `the website worker didn't pick it up in ${WORKER_QUIET_MINUTES} minutes`);
      done.push(`${PORTAL_KIND_LABEL[task.kind]} on ${hostOf(task)}: worker quiet, to support`);
    } else if (task.status === "needs_code" && task.data.codeAskedAt && now - Date.parse(task.data.codeAskedAt) > 10 * 60_000 && !task.data.code) {
      await askOwner(task, "What's the code they just sent you (by text or email)?", "one_time_code", false);
      done.push(`${hostOf(task)}: code asked of the owner`);
    } else if ((task.status === "needs_approval" || task.status === "needs_answer") && age > 24 * 3600_000 && (await claimMark(ctx.carrier.id, task.id, "portal_nudge"))) {
      await tellOwner(ctx, { reason: `Still waiting on you for ${PORTAL_KIND_LABEL[task.kind].toLowerCase()} on ${hostOf(task)} (see Needs you).`, loadId: task.load_id ?? undefined, source: "email" });
    }
  }
  return done;
}
