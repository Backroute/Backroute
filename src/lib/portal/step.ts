import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, aiConfigured, claude } from "../ai/server";
import { inboundAddress } from "../channels/email";
import { admin, latestFiles, filesById, loadContext, storeFile, type CarrierContext } from "../agent/db";
import { formatAtStop, isoToStopLocal, stopLocalToIso } from "../stop-time";
import type { Load } from "../types";
import { answerFor, answerKeys, hasLogin, loginFor, newPassword, open, saveLogin, seal, siteOf, totpCode } from "./vault";
import { askApproval, askOwner, completeTask, extendLease, giveUpOn, mismatch, updateTask } from "./tasks";
import type { PortalStepLog, PortalTask } from "./types";

/**
 * One step on another company's website. The worker sends what's on the page (its text, the things you can click or
 * type in, numbered, and a screenshot); the AI picks the next thing to do; the app checks it before the worker does
 * it. The AI never sees a password, a 2-step code or a saved answer: it writes a placeholder and the app puts the
 * real value in for that one field, only on the website that login belongs to. The click that signs, submits or books
 * is let through only when it's safe (lib/portal/tasks says when), otherwise it waits for the owner.
 */

interface PageElement {
  i: number;
  tag: string;
  type?: string;
  role?: string;
  label: string;
  value?: string;
  checked?: boolean;
  options?: string[];
  required?: boolean;
  disabled?: boolean;
}

interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
  /** JPEG, base64. */
  screenshot?: string;
}

interface LastResult {
  ok: boolean;
  error?: string;
  /** A file the page gave when the worker clicked download. */
  download?: { name: string; contentType: string; base64: string };
}

type WorkerAction =
  | { do: "click"; element: number; download?: boolean }
  | { do: "check" | "uncheck"; element: number }
  | { do: "fill"; element: number; value: string }
  | { do: "select"; element: number; value: string }
  | { do: "upload"; element: number; file: { name: string; contentType: string; base64: string } }
  | { do: "press"; key: string }
  | { do: "scroll"; direction: "down" | "up" }
  | { do: "wait"; seconds: number }
  | { do: "finish"; outcome: "done" | "failed" | "parked" | "stopped"; note?: string };

const MAX_STEPS = 60;
/** How long the worker keeps a page open waiting on the owner before it lets go (the job starts over later). */
const PARK_MINUTES = 10;
const PAPERS = new Set(["w9", "coi", "authority", "noa", "voided_check", "rate_con", "rate_con_signed"]);
const KEYS = new Set(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Space"]);

const Decision = z.object({
  seeing: z.string().describe("One short sentence: what page this is and how far along the job is."),
  action: z.enum(["click", "fill", "select", "check", "uncheck", "upload", "press", "scroll", "wait", "download", "done", "ask_owner", "need_code", "stuck", "mismatch"]),
  element: z.number().int().nullable().describe("The [number] of the element to act on, for click, fill, select, check, uncheck, upload and download."),
  value: z
    .string()
    .nullable()
    .describe("fill: the text, or a placeholder like {{password}}. select: the option's text. upload: which paper (w9, coi, authority, noa, voided_check, rate_con). press: the key (Enter, Tab, Escape)."),
  final: z.boolean().describe("True when this click signs, submits, books, finishes, or agrees to terms: anything binding on the carrier."),
  seenRate: z.number().nullable().describe("Signing a rate con: the total rate (all in, in dollars) the document on the page shows, once you've seen it."),
  appointmentLocal: z.string().nullable().describe("Dock appointment: the slot you're booking, as YYYY-MM-DDTHH:mm in the facility's local time."),
  confirmation: z.string().nullable().describe("Dock appointment: the confirmation number, once the site shows one."),
  question: z.string().nullable().describe("ask_owner: one short question for the carrier's owner."),
  questionKey: z.string().nullable().describe("ask_owner: a short snake_case key for the answer so it can be reused (ein, bank_routing, insurance_agent_phone), or login:<site> for a login."),
  questionSecret: z.boolean().nullable().describe("ask_owner: true for bank numbers, tax IDs and other private numbers."),
  note: z.string().nullable().describe("stuck, mismatch or done: what happened, in a sentence."),
});
type Decision = z.infer<typeof Decision>;

// ─── Facts for the AI ────────────────────────────────────────────────────────

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const agreedRate = (load: Load) => load.bookedRate ?? load.bookRequest?.ask ?? load.targetRate;
const accountEmail = (ctx: CarrierContext) => (ctx.carrier.inbound_key ? inboundAddress(ctx.carrier.inbound_key) : null) ?? ctx.settings.remitEmail ?? null;

async function carrierFacts(ctx: CarrierContext): Promise<string> {
  const { data } = await admin().from("carriers").select("dot").eq("id", ctx.carrier.id).maybeSingle();
  const equipment = [...new Set(ctx.trucks.map((t) => t.equipmentType))].join(", ");
  const s = ctx.settings;
  const lines = [
    `Company: ${ctx.carrier.name}`,
    ctx.carrier.mc ? `MC number: ${String(ctx.carrier.mc).replace(/^mc[\s-]*/i, "")}` : null,
    data?.dot ? `USDOT number: ${data.dot}` : null,
    s.businessAddress ? `Address: ${s.businessAddress}` : null,
    ctx.carrier.owner_phone ? `Phone: ${ctx.carrier.owner_phone}` : null,
    accountEmail(ctx) ? `Email for dispatch and for new accounts: {{account_email}}` : null,
    s.remitEmail ? `Billing email: ${s.remitEmail}` : null,
    s.factoringEmail ? `Factoring: yes, invoices go to ${s.factoringEmail} (pay to the factoring company; the notice of assignment is a paper you can upload)` : "Factoring: no",
    s.rateConSigner?.name ? `Authorized signer: ${s.rateConSigner.name}${s.rateConSigner.title ? `, ${s.rateConSigner.title}` : ""}` : null,
    `Trucks: ${ctx.trucks.length}${equipment ? ` (${equipment})` : ""}; drivers: ${ctx.drivers.length}`,
    `Hazmat: ${s.hazmat ? "yes" : "no"}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function goal(ctx: CarrierContext, task: PortalTask, load: Load | undefined): string {
  const signer = ctx.settings.rateConSigner;
  const lane = load ? `${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState}` : "";
  if (task.kind === "sign_rate_con" && load)
    return [
      `Sign the broker's rate confirmation for load ${load.referenceNumber} (${lane}; pickup ${load.pickupWindow}, delivery ${load.deliveryWindow}), as ${signer?.name}${signer?.title ? `, ${signer.title}` : ""}, for ${ctx.carrier.name}.`,
      `What was agreed: ${money(agreedRate(load))} all in.`,
      `Accept the electronic records and signatures consent, start, and sign or initial every place it asks with the signer's name (adopt a typed signature in that name). Don't change any field the broker filled in.`,
      `Before the last click (Finish, Submit, Accept), look at the document on the page or in the screenshot and put its total rate in seenRate. If it isn't what was agreed, answer mismatch instead of signing.`,
      `After it's signed, if there's a Download button for the signed copy, use download on it once; then done.`,
    ].join(" ");
  if (task.kind === "carrier_setup")
    return [
      `Complete ${ctx.carrier.name}'s carrier setup${task.data.fromName ? ` for ${task.data.fromName}` : ""} on this website, so the broker can book and pay the carrier.`,
      `Use the carrier's details below, upload the papers where asked, and answer the questions truthfully from what you know. If a login is needed: {{username}} and {{password}} when the carrier has one here; otherwise register with {{account_email}} and {{new_password}} (the same {{new_password}} in both password boxes).`,
      `Agreeing to the broker-carrier agreement and the last Submit are final. Anything required you don't know (a tax ID, bank details, insurance agent) is ask_owner with a key; never guess or make it up. Bank and card numbers only ever come from a saved answer ({{fact:key}}).`,
    ].join(" ");
  if (task.kind === "dock_appointment" && load && task.data.stop) {
    const stop = task.data.stop;
    const state = stop === "pickup" ? load.lane.originState : load.lane.destState;
    const at = stop === "pickup" ? load.pickupAt : load.deliveryAt;
    const window = at ? `${formatAtStop(at, state)} (${isoToStopLocal(at, state)} local)` : stop === "pickup" ? load.pickupWindow : load.deliveryWindow;
    const r = load.rateConReading;
    return [
      `Book the ${stop} dock appointment for load ${load.referenceNumber} at ${stop === "pickup" ? r?.shipper ?? load.lane.origin : r?.receiver ?? load.lane.destination} (${stop === "pickup" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`}).`,
      `The load's ${stop} window: ${window}. Pick the earliest open slot in that window; put it in appointmentLocal before the booking click (which is final).`,
      `The load number is ${load.referenceNumber}${r?.loadNumber && r.loadNumber !== load.referenceNumber ? `; the broker's is ${r.loadNumber}` : ""}. ${load.commodity ? `Commodity: ${load.commodity}. ` : ""}${load.weight ? `Weight: ${load.weight} lb. ` : ""}Put the confirmation number in confirmation, then done.`,
    ].join(" ");
  }
  return "Nothing to do here: answer stuck.";
}

/**
 * What's known about the websites brokers use most, for the AI: where things are and what trips it up. Filled in as
 * each site is tried for real (docs: portal-worker/README.md).
 */
const SITE_HINTS: [RegExp, string][] = [
  [/docusign\.(net|com)$/, "DocuSign: tick the electronic records box, Continue, then Start (or the first yellow Sign tag); each Sign/Initial tag opens Adopt Your Signature once (keep the typed style, Adopt and Sign); Next moves between tags; Finish is final. Other Actions has Download only after finishing."],
  [/(echosign|adobesign|documents\.adobe)\.com$/, "Adobe Acrobat Sign: click the yellow Start arrow, then each signature field ('Click here to sign'), type the name, Apply; 'Click to Sign' at the bottom is final."],
  [/(hellosign|dropboxsign)\.com$/, "Dropbox Sign: agree to the terms, click each signature box, Type it, Insert; 'I agree' then Continue is final."],
  [/pandadoc\.com$/, "PandaDoc: click each signature field, Accept and sign; Finish document is final."],
  [/mycarrierpackets\.com$/, "MyCarrierPackets: a carrier profile is shared with the broker who invited it; if the carrier has an account, sign in and accept the broker's request instead of filling the packet again. The e-signature on the broker agreement is final."],
  [/(rmis|registrymonitoring)\.com$/, "RMIS: the invite link opens the broker's own packet; sign in with the carrier's RMIS login if asked; insurance comes from the agent, so put the agent's details and don't upload the certificate as if it were verified."],
  [/highway\.com$/, "Highway: carriers sign in to connect with the broker; identity checks (a phone code or a selfie) are need_code or ask_owner, never guessed."],
  [/opendock\.com$/, "Opendock: choose the warehouse and dock if asked, the load or PO number, then a time; Book appointment is final and shows a confirmation number."],
  [/c3(reservations|solutions)\.com$/, "C3 Reservations: search by PO, pick an open slot in the load's window, submit (final), copy the confirmation number."],
];
const hintFor = (host: string) => SITE_HINTS.filter(([re]) => re.test(host)).map(([, h]) => h).join(" ");

const SYSTEM = `You are working a web page for a trucking company, one step at a time, as its dispatcher would. Each turn you get the job, what the carrier knows, the page (its text and the elements you can use, each with a [number]), a screenshot, and what you did so far. Answer with the single next action.

Rules:
- Only use elements from the list, by number. Fill one field per step. Prefer the obvious path: consent boxes, Continue, Next, the fields, Submit.
- Never type a password, code or private number yourself: write the placeholder. {{username}} and {{password}} for the carrier's login on this site, {{totp}} for its 2-step code, {{email_code}} for a code the site emailed (once one has arrived), {{account_email}} for the carrier's email, {{new_password}} when opening a new account, {{fact:key}} for a saved answer.
- A code sent by email or text that hasn't arrived: need_code. A 2-step code when the carrier has a 2-step key here: fill {{totp}}.
- final is true for the click that signs, submits, books, accepts or agrees. Filling fields and ticking consent boxes is not final.
- Don't click ads, chat widgets, social links, or anything unrelated to the job. Don't log out. Close cookie banners with the accept button if they block the page.
- If the page is broken, the link expired, or you've tried the same thing twice and it didn't work: stuck, with a note.
- When the job is complete and the site shows it (a thank-you page, "completed", a confirmation number): done.`;

function describe(el: PageElement): string {
  const bits = [`[${el.i}] ${el.tag}${el.type ? `[type=${el.type}]` : ""}${el.role ? ` role=${el.role}` : ""}`, JSON.stringify(el.label.slice(0, 120))];
  if (el.value) bits.push(`value=${JSON.stringify(el.value.slice(0, 60))}`);
  if (el.checked !== undefined) bits.push(el.checked ? "checked" : "unchecked");
  if (el.options?.length) bits.push(`options: ${el.options.slice(0, 25).map((o) => JSON.stringify(o.slice(0, 40))).join(", ")}`);
  if (el.required) bits.push("required");
  if (el.disabled) bits.push("disabled");
  return bits.join(" ");
}

async function decide(ctx: CarrierContext, task: PortalTask, load: Load | undefined, page: PageSnapshot): Promise<Decision | null> {
  const host = siteOf(page.url) ?? "";
  const [facts, login, keys, papers] = await Promise.all([carrierFacts(ctx), hasLogin(ctx.carrier.id, host), answerKeys(ctx.carrier.id), latestFiles(ctx.carrier.id, ["w9", "coi", "authority", "noa", "voided_check"])]);
  const history = (task.data.steps ?? []).slice(-15).map((s) => `- ${s.action}${s.target ? ` ${s.target}` : ""}${s.value ? ` = ${s.value}` : ""}${s.ok === false ? ` (failed: ${s.error ?? "error"})` : ""}`);
  const context = [
    `JOB: ${goal(ctx, task, load)}`,
    hintFor(host) ? `ABOUT THIS SITE: ${hintFor(host)}` : null,
    task.data.approvedAt ? "The owner approved the final submit: go ahead with it." : null,
    task.data.code ? "A code the site sent has arrived: fill it with {{email_code}}." : null,
    `\nTHE CARRIER:\n${facts}`,
    login ? `Login on this site: yes, use {{username}} and {{password}}${login.twoStep ? ", and {{totp}} for its 2-step code" : ""}.` : "Login on this site: none saved.",
    keys.length ? `Saved answers: ${keys.map((k) => `{{fact:${k.key}}} (${k.label})`).join(", ")}` : null,
    `Papers you can upload: ${papers.map((p) => p.kind).join(", ") || "none"}${task.kind === "sign_rate_con" ? ", rate_con" : ""}.`,
    `\nWHAT YOU DID SO FAR:\n${history.length ? history.join("\n") : "- nothing yet"}`,
    `\nTHE PAGE: ${page.title} — ${page.url}\nTEXT:\n${page.text.slice(0, 8000)}\n\nELEMENTS:\n${page.elements.slice(0, 300).map(describe).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const response = await claude().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 1500,
      ...FALLBACK,
      output_config: { effort: "medium", format: betaZodOutputFormat(Decision) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...(page.screenshot ? [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: page.screenshot } }] : []),
            { type: "text" as const, text: context },
          ],
        },
      ],
    });
    return response.parsed_output ?? null;
  } catch (e) {
    console.error("[portal] couldn't decide the next step", e);
    return null;
  }
}

// ─── The step ────────────────────────────────────────────────────────────────

async function screenshotFile(task: PortalTask, page: PageSnapshot, why: string): Promise<string | undefined> {
  if (!page.screenshot) return undefined;
  try {
    return await storeFile(task.carrier_id, { kind: "portal_screenshot", name: `${siteOf(page.url) ?? "website"}-${why}.jpg`.replace(/[^\w.-]+/g, "-"), contentType: "image/jpeg", bytes: Buffer.from(page.screenshot, "base64"), loadId: task.load_id, note: `${why} · ${page.url.slice(0, 180)}` });
  } catch (e) {
    console.error("[portal] couldn't keep the screenshot", e);
    return undefined;
  }
}

const log = (task: PortalTask, entry: Omit<PortalStepLog, "at">) => updateTask(task, {}, { steps: [...(task.data.steps ?? []), { at: new Date().toISOString(), ...entry }].slice(-120) });

/** Puts the real values in for the placeholders, or says why it can't. */
async function resolve(ctx: CarrierContext, task: PortalTask, host: string, value: string): Promise<{ value: string; opened?: string } | { missing: string }> {
  let out = value;
  let opened: string | undefined;
  for (const m of value.matchAll(/\{\{\s*([a-z_]+)(?::([a-z0-9_]+))?\s*\}\}/gi)) {
    const [whole, name, arg] = m;
    let real: string | null = null;
    const n = name.toLowerCase();
    if (n === "username" || n === "password" || n === "totp") {
      const login = await loginFor(ctx.carrier.id, host);
      if (!login) return { missing: `login:${host}` };
      real = n === "username" ? login.username : n === "password" ? login.password : login.totp ? totpCode(login.totp) : null;
      if (real === null) return { missing: n === "totp" ? "one_time_code" : `login:${host}` };
    } else if (n === "account_email") real = accountEmail(ctx);
    else if (n === "new_password") {
      // Only for opening the carrier's account on a setup network, and only where there isn't one. The same new
      // password fills the confirm box: it's saved on first use.
      if (task.kind !== "carrier_setup") return { missing: `login:${host}` };
      const existing = await loginFor(ctx.carrier.id, host);
      if (existing && task.data.opened === host) real = existing.password;
      else if (existing) return { missing: `login:${host}` };
      else {
        real = newPassword();
        await saveLogin(ctx.carrier.id, { site: host, label: `${host} (opened by the AI)`, username: accountEmail(ctx) ?? ctx.carrier.name, password: real, by: "ai" });
        opened = host;
      }
    } else if (n === "email_code") {
      real = task.data.code ? (open(task.data.code.sealed, `${task.carrier_id}|code|${task.id}`)?.value ?? null) : null;
      if (!real) return { missing: "one_time_code" };
    } else if (n === "fact" && arg) {
      real = await answerFor(ctx.carrier.id, arg.toLowerCase());
      if (real === null) return { missing: arg.toLowerCase() };
    }
    if (real === null) return { missing: n };
    out = out.replace(whole, real);
  }
  return { value: out, opened };
}

/** Is the binding click all right to make now? Returns why not (for the owner), or null. */
function holdFinal(ctx: CarrierContext, task: PortalTask, load: Load | undefined, d: Decision): { mismatch?: string; ask?: string } | null {
  // A rate that isn't what was agreed is never signed, the owner's OK to sign unread included.
  if (task.kind === "sign_rate_con" && load && d.seenRate !== null && Math.abs(d.seenRate - agreedRate(load)) > 1)
    return { mismatch: `rate: we agreed ${money(agreedRate(load))}, the rate con in their portal says ${money(d.seenRate)}` };
  if (task.data.approvedAt) return null;
  if (task.kind === "sign_rate_con") {
    if (!load) return { ask: "The AI can't find the load this rate con is for." };
    const agreed = agreedRate(load);
    if (d.seenRate === null && !task.data.verified) return { ask: `Sign the rate con for ${load.referenceNumber} as ${ctx.settings.rateConSigner?.name}? The AI couldn't read the rate on the page to check it against the ${money(agreed)} agreed.` };
    return null;
  }
  if (task.kind === "carrier_setup") {
    if (ctx.settings.autonomy === "full" || ctx.settings.ownerRules?.portal_setup) return null;
    return { ask: `The AI filled in ${ctx.carrier.name}'s carrier setup${task.data.fromName ? ` for ${task.data.fromName}` : ""} and is ready to submit it (with the broker-carrier agreement).` };
  }
  if (task.kind === "dock_appointment" && load && task.data.stop) {
    const state = task.data.stop === "pickup" ? load.lane.originState : load.lane.destState;
    const iso = stopLocalToIso(d.appointmentLocal, state);
    const start = task.data.stop === "pickup" ? load.pickupAt : load.deliveryAt;
    if (!iso) return { ask: `Book the ${task.data.stop} appointment for ${load.referenceNumber}? The AI couldn't tell which time it picked.` };
    const t = Date.parse(iso);
    if (t < Date.now()) return { ask: `The slot the AI picked for ${load.referenceNumber} (${formatAtStop(iso, state)}) is in the past.` };
    if (start && t >= Date.parse(start) - 3 * 3600_000 && t <= Date.parse(start) + 36 * 3600_000) return null;
    return { ask: `Book ${formatAtStop(iso, state)} for the ${task.data.stop} on ${load.referenceNumber}? It's outside the load's window${start ? ` (${formatAtStop(start, state)})` : ""}.` };
  }
  return { ask: "The AI isn't sure it should submit this." };
}

/**
 * The worker's turn: what it saw and how its last action went → the next action. Keeps the job's log and lease, and
 * hands off (to the owner or support) when the AI can't or shouldn't go on.
 */
export async function portalStep(task: PortalTask, page: PageSnapshot, last: LastResult | null): Promise<WorkerAction> {
  if (["done", "failed", "cancelled"].includes(task.status)) return { do: "finish", outcome: task.status === "done" ? "done" : "stopped", note: task.data.note };
  const host = siteOf(page.url) ?? "";
  // How the last action went, on the log.
  const steps = task.data.steps ?? [];
  if (last && steps.length && steps[steps.length - 1].ok === undefined) {
    steps[steps.length - 1] = { ...steps[steps.length - 1], ok: last.ok, ...(last.error ? { error: last.error.slice(0, 200) } : {}) };
    task = await updateTask(task, {}, { steps });
  }
  task = await extendLease(task);
  const ctx = await loadContext(task.carrier_id);
  if (!ctx) return { do: "finish", outcome: "stopped", note: "carrier gone" };
  const load = task.load_id ? ctx.loads.find((l) => l.id === task.load_id) : undefined;

  // The signed copy the page gave: kept with the load.
  if (last?.download && task.kind === "sign_rate_con" && load && last.download.contentType === "application/pdf") {
    const bytes = Buffer.from(last.download.base64, "base64");
    if (bytes.length < 10 * 1024 * 1024) {
      const id = await storeFile(ctx.carrier.id, { kind: "rate_con_signed", name: `${load.referenceNumber || "rate-con"}-signed.pdf`.replace(/[^\w.-]+/g, "-"), contentType: "application/pdf", bytes, loadId: load.id, note: `Signed on ${host}` });
      task = await updateTask(task, {}, { signedFileId: id });
    }
  }

  // Waiting on the owner or a code: the page stays open for a while, then the worker lets go.
  if (task.status === "needs_code" && task.data.code) task = await updateTask(task, { status: "running" });
  if (task.status === "needs_approval" || task.status === "needs_answer" || task.status === "needs_code") {
    const since = Date.parse(task.data.pending?.at ?? task.data.question?.at ?? task.data.codeAskedAt ?? task.updated_at);
    if (Date.now() - since > PARK_MINUTES * 60_000) {
      await updateTask(task, { locked_until: null }, { parked: true });
      return { do: "finish", outcome: "parked", note: "waiting on the owner" };
    }
    return { do: "wait", seconds: 5 };
  }

  if (steps.length >= MAX_STEPS) {
    await giveUpOn(task, `${MAX_STEPS} steps without finishing`, await screenshotFile(task, page, "stuck"));
    return { do: "finish", outcome: "failed", note: "too many steps" };
  }
  if (!aiConfigured()) {
    await giveUpOn(task, "the AI isn't switched on");
    return { do: "finish", outcome: "failed", note: "no AI" };
  }
  if (task.kind === "sign_rate_con" && !ctx.settings.rateConSigner?.name) {
    await giveUpOn(task, "no one is set up to sign rate cons (Settings → Your rules)");
    return { do: "finish", outcome: "failed", note: "no signer" };
  }

  const d = await decide(ctx, task, load, page);
  if (!d) {
    // The AI didn't answer: wait and look again, a few times, before giving up.
    const misses = steps.slice(-3).filter((s) => s.action === "wait" && s.note === "no decision").length;
    if (misses >= 3) {
      await giveUpOn(task, "the AI couldn't read the page", await screenshotFile(task, page, "unreadable"));
      return { do: "finish", outcome: "failed", note: "no decision" };
    }
    await log(task, { url: page.url, action: "wait", note: "no decision", ok: true });
    return { do: "wait", seconds: 3 };
  }

  const el = d.element !== null ? page.elements.find((e) => e.i === d.element) : undefined;
  const needsEl = ["click", "fill", "select", "check", "uncheck", "upload", "download"].includes(d.action);
  if (needsEl && !el) {
    await log(task, { url: page.url, action: d.action, target: `#${d.element}`, ok: false, error: "no such element", note: d.seeing });
    return { do: "wait", seconds: 1 };
  }
  const target = el ? `[${el.i}] ${el.label.slice(0, 60)}` : undefined;

  switch (d.action) {
    case "ask_owner": {
      const key = (d.questionKey ?? "answer").toLowerCase().slice(0, 80);
      await log(task, { url: page.url, action: "ask_owner", note: d.question ?? undefined, ok: true });
      await askOwner(await refreshed(task), d.question ?? "The website asks for something the AI doesn't know.", key, !!d.questionSecret || key.startsWith("login:"), await screenshotFile(task, page, "question"));
      return { do: "wait", seconds: 5 };
    }
    case "need_code": {
      await log(task, { url: page.url, action: "need_code", ok: true });
      await updateTask(await refreshed(task), { status: "needs_code" }, { codeAskedAt: new Date().toISOString(), code: undefined });
      return { do: "wait", seconds: 5 };
    }
    case "stuck": {
      await log(task, { url: page.url, action: "stuck", note: d.note ?? d.seeing, ok: true });
      await giveUpOn(await refreshed(task), d.note ?? "stuck on the website", await screenshotFile(task, page, "stuck"));
      return { do: "finish", outcome: "failed", note: d.note ?? undefined };
    }
    case "mismatch": {
      await log(task, { url: page.url, action: "mismatch", note: d.note ?? undefined, ok: true });
      const what = load && d.seenRate !== null ? `rate: we agreed ${money(agreedRate(load))}, the rate con in their portal says ${money(d.seenRate)}` : (d.note ?? "the document isn't what was agreed");
      await mismatch(await refreshed(task), what, await screenshotFile(task, page, "mismatch"));
      return { do: "finish", outcome: "stopped", note: what };
    }
    case "done": {
      // A dock appointment has to say when.
      if (task.kind === "dock_appointment" && !d.appointmentLocal && !task.data.appointment?.local) {
        await log(task, { url: page.url, action: "done", ok: false, error: "no appointment time" });
        return { do: "wait", seconds: 1 };
      }
      // Signed or submitted means the AI made that click here: a page that only says "completed" (someone else
      // signed it, it was done before) isn't taken as our signature. Support looks.
      if (task.kind !== "dock_appointment" && !(task.data.steps ?? []).some((s) => s.final && s.action !== "hold" && s.ok !== false)) {
        await log(task, { url: page.url, action: "done", ok: false, error: "done without a signature or submit" });
        await giveUpOn(await refreshed(task), "the website says it's complete, but the AI never signed or submitted it there", await screenshotFile(task, page, "done-unclear"));
        return { do: "finish", outcome: "failed", note: "done without a final click" };
      }
      await log(task, { url: page.url, action: "done", note: d.note ?? undefined, ok: true });
      const shot = await screenshotFile(task, page, "done");
      let t = await refreshed(task);
      if (d.appointmentLocal || d.confirmation) t = await updateTask(t, {}, { appointment: { local: d.appointmentLocal ?? t.data.appointment?.local ?? "", confirmation: d.confirmation ?? t.data.appointment?.confirmation ?? null } });
      await completeTask(t, { note: d.note ?? undefined, screenshotId: shot });
      return { do: "finish", outcome: "done", note: d.note ?? undefined };
    }
    case "wait":
      await log(task, { url: page.url, action: "wait", ok: true, note: d.seeing });
      return { do: "wait", seconds: 3 };
    case "scroll":
      await log(task, { url: page.url, action: "scroll", ok: undefined, note: d.seeing });
      return { do: "scroll", direction: /up/i.test(d.value ?? "") ? "up" : "down" };
    case "press": {
      const key = KEYS.has(d.value ?? "") ? d.value! : "Enter";
      if (d.final) break;
      await log(task, { url: page.url, action: "press", value: key });
      return { do: "press", key };
    }
    default:
      break;
  }

  // The binding click: let through, stopped as a mismatch, or held for the owner.
  if (d.final) {
    const hold = holdFinal(ctx, task, load, d);
    if (d.appointmentLocal) task = await updateTask(task, {}, { appointment: { local: d.appointmentLocal, confirmation: d.confirmation } });
    if (hold?.mismatch) {
      await log(task, { url: page.url, action: "mismatch", target, note: hold.mismatch, ok: true });
      await mismatch(await refreshed(task), hold.mismatch, await screenshotFile(task, page, "mismatch"));
      return { do: "finish", outcome: "stopped", note: hold.mismatch };
    }
    const shot = await screenshotFile(task, page, hold ? "before-approval" : "before-submit");
    if (hold?.ask) {
      await log(task, { url: page.url, action: "hold", target, note: hold.ask, ok: true, final: true });
      await askApproval(await refreshed(task), hold.ask, shot, el?.i);
      return { do: "wait", seconds: 5 };
    }
    if (shot) task = await updateTask(await refreshed(task), {}, { screenshots: [...(task.data.screenshots ?? []), shot] });
  }

  switch (d.action) {
    case "press":
      await log(task, { url: page.url, action: "press", value: d.value ?? "Enter", final: true });
      return { do: "press", key: KEYS.has(d.value ?? "") ? d.value! : "Enter" };
    case "click":
    case "download":
    case "check":
    case "uncheck":
      await log(task, { url: page.url, action: d.action, target, final: d.final || undefined });
      return d.action === "check" || d.action === "uncheck" ? { do: d.action, element: el!.i } : { do: "click", element: el!.i, ...(d.action === "download" ? { download: true } : {}) };
    case "select":
      await log(task, { url: page.url, action: "select", target, value: (d.value ?? "").slice(0, 60) });
      return { do: "select", element: el!.i, value: d.value ?? "" };
    case "fill": {
      const raw = d.value ?? "";
      const r = await resolve(ctx, task, host, raw);
      if ("missing" in r) {
        const login = r.missing.startsWith("login:");
        const question = login ? `What's ${ctx.carrier.name}'s login (user name and password) for ${host}?` : r.missing === "one_time_code" ? `What's the code ${host} just sent you?` : `The website needs ${r.missing.replace(/_/g, " ")}. What is it?`;
        await log(task, { url: page.url, action: "ask_owner", note: question, ok: true });
        await askOwner(await refreshed(task), question, r.missing, true, await screenshotFile(task, page, "question"));
        return { do: "wait", seconds: 5 };
      }
      if (r.opened) task = await updateTask(await refreshed(task), {}, { opened: r.opened });
      // What's kept on the log: the placeholder, never the value it stood for; nothing typed into a password box.
      const shown = /\{\{/.test(raw) ? raw : el?.type === "password" ? "•••" : raw.slice(0, 60);
      await log(task, { url: page.url, action: "fill", target, value: shown });
      if (/\{\{\s*email_code/i.test(raw)) task = await updateTask(await refreshed(task), {}, { code: undefined });
      return { do: "fill", element: el!.i, value: r.value };
    }
    case "upload": {
      const kind = (d.value ?? "").toLowerCase();
      // A voided check goes only into a carrier setup; nothing but the carrier's own papers goes anywhere.
      if (!PAPERS.has(kind) || (kind === "voided_check" && task.kind !== "carrier_setup")) {
        await log(task, { url: page.url, action: "upload", target, value: kind, ok: false, error: "not a paper the AI can send here" });
        return { do: "wait", seconds: 1 };
      }
      const [meta] = await latestFiles(ctx.carrier.id, [kind], kind.startsWith("rate_con") ? task.load_id ?? undefined : undefined);
      const [file] = meta ? await filesById(ctx.carrier.id, [meta.id]) : [];
      if (!file) {
        await log(task, { url: page.url, action: "ask_owner", note: `no ${kind} on file`, ok: true });
        await askOwner(await refreshed(task), `The website wants your ${kind.replace(/_/g, " ").replace("w9", "W-9").replace("coi", "insurance certificate")}. Upload it in Settings → Your papers, then answer "done".`, `paper_${kind}`, false, await screenshotFile(task, page, "question"));
        return { do: "wait", seconds: 5 };
      }
      await log(task, { url: page.url, action: "upload", target, value: file.name });
      return { do: "upload", element: el!.i, file: { name: file.name, contentType: file.content_type, base64: file.data } };
    }
  }
  await log(task, { url: page.url, action: d.action, ok: false, error: "not something the worker does" });
  return { do: "wait", seconds: 1 };
}

/** The job as saved now (another request may have changed it). */
async function refreshed(task: PortalTask): Promise<PortalTask> {
  const { data } = await admin().from("portal_tasks").select("*").eq("id", task.id).maybeSingle();
  return (data as PortalTask | null) ?? task;
}

/** A code a website emailed to the carrier's AI address, for a job waiting on one from that site. */
export async function takeEmailedCode(carrierId: string, from: string, subject: string, text: string): Promise<boolean> {
  const domain = (from.split("@")[1] ?? "").toLowerCase();
  const { data } = await admin().from("portal_tasks").select("*").eq("carrier_id", carrierId).in("status", ["needs_code", "running"]).order("updated_at", { ascending: false }).limit(10);
  const tasks = (data ?? []) as PortalTask[];
  const code = `${subject}\n${text}`.match(/(?:code|passcode|pin|verification|one[- ]time)[^0-9]{0,40}\b([0-9]{4,8})\b/i)?.[1] ?? `${subject}\n${text}`.match(/\b([0-9]{6})\b/)?.[1];
  if (!code) return false;
  // The job on the website that sent it: the sender's domain names the site (no-reply@mycarrierpackets.com for a job
  // on mycarrierpackets.com, dse@docusign.net for one on na3.docusign.net).
  const root = domain.split(".").slice(-2)[0] ?? "";
  const task = root.length >= 4 ? tasks.find((t) => t.url.toLowerCase().includes(root)) : undefined;
  if (!task || !/code|verif|passcode|sign.?in|log.?in|one[- ]time/i.test(`${subject}\n${text}`)) return false;
  await updateTask(task, { status: task.status === "needs_code" ? "running" : task.status }, { code: { sealed: seal(code, `${carrierId}|code|${task.id}`), at: new Date().toISOString(), from } });
  return true;
}
