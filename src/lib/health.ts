import "server-only";
import { admin } from "./agent/db";
import { aiConfigured } from "./ai/server";
import { emailConfigured } from "./channels/email";
import { emailOurTeam, textTo } from "./channels/out";
import { twilioConfigured } from "./channels/twilio";
import { portalReady } from "./portal/tasks";
import { whatsappConfigured } from "./channels/twilio";
import { spokenRepliesConfigured, transcriptionConfigured } from "./channels/voice-notes";

/**
 * Is Backroute working? Each part of the system is checked: the database, the AI, texts, email, the dispatcher's
 * rounds, the voice server, the website worker, messages stuck waiting for a provider, and AI spending. Support sees
 * the report in the console (System tab), uptime monitors can watch /api/health, and every round of the dispatcher
 * alerts whoever is on call (ALERT_PHONES, or the support phones; and SUPPORT_EMAIL) when something goes down: once per problem per hour, and
 * once more when it's fixed.
 */

type Level = "ok" | "warn" | "down" | "off";
interface Check {
  key: string;
  label: string;
  level: Level;
  detail: string;
}

const MIN = 60_000;

/** A part of the system checking in (the rounds, the website worker). */
export async function beat(name: string, data: Record<string, unknown> = {}) {
  await admin()
    .from("service_heartbeats")
    .upsert({ name, at: new Date().toISOString(), data }, { onConflict: "name" })
    .then(({ error }) => error && console.error("[health] heartbeat failed", name, error.message));
}

async function heartbeat(name: string): Promise<{ at: number; data: Record<string, unknown> } | null> {
  const { data } = await admin().from("service_heartbeats").select("at, data").eq("name", name).maybeSingle();
  return data ? { at: Date.parse(data.at as string), data: (data.data ?? {}) as Record<string, unknown> } : null;
}

const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} seconds ago` : ms < 2 * 3600_000 ? `${Math.round(ms / MIN)} minutes ago` : `${Math.round(ms / 3600_000)} hours ago`);

const price = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Every check, now. */
export async function healthReport(now = Date.now()): Promise<Check[]> {
  const checks: Check[] = [];
  const db = admin();

  // The database: everything else needs it.
  const started = Date.now();
  const { error: dbError } = await db.from("carriers").select("id", { head: true, count: "exact" }).limit(1);
  const took = Date.now() - started;
  checks.push({ key: "database", label: "Database", level: dbError ? "down" : took > 3000 ? "warn" : "ok", detail: dbError ? `Can't reach it: ${dbError.message}` : `Answered in ${took} ms` });
  if (dbError) return checks;

  // The AI: set up, and not failing. Messages the AI couldn't answer even on a second try go to support as "system".
  const hourAgo = new Date(now - 60 * MIN).toISOString();
  const { data: failures } = await db.from("escalations").select("data").eq("status", "with_support").gte("updated_at", hourAgo).limit(200);
  // The same wording the support console files under "our own systems failing" (lib/support-playbooks).
  const aiFails = (failures ?? []).filter((r) => /(The AI|Backroute) couldn't answer|couldn't write a reply/i.test(String((r.data as { reason?: string }).reason ?? ""))).length;
  checks.push({
    key: "ai",
    label: "AI",
    level: !aiConfigured() ? "down" : aiFails >= 5 ? "down" : aiFails >= 2 ? "warn" : "ok",
    detail: !aiConfigured() ? "No ANTHROPIC_API_KEY: nothing gets answered" : aiFails ? `${aiFails} message${aiFails === 1 ? "" : "s"} it couldn't answer in the last hour` : "Answering",
  });

  checks.push({ key: "texts", label: "Texts and calls (Twilio)", level: twilioConfigured() ? "ok" : "down", detail: twilioConfigured() ? "Set up" : "Twilio isn't set up" });
  checks.push({ key: "whatsapp", label: "WhatsApp", level: whatsappConfigured() ? "ok" : "off", detail: whatsappConfigured() ? `Set up${process.env.TWILIO_WHATSAPP_TEMPLATE_SID ? ", with a template for after 24 hours" : "; after 24 hours of quiet, texts go by SMS"}` : "Not set up: drivers text by SMS" });
  checks.push({ key: "voice_notes", label: "Voice messages", level: transcriptionConfigured() ? "ok" : "off", detail: transcriptionConfigured() ? `Transcribed${spokenRepliesConfigured() ? "; answers spoken back on WhatsApp" : ""}` : "Not set up: drivers are asked to type" });
  checks.push({ key: "email", label: "Email (Postmark)", level: emailConfigured() ? "ok" : "down", detail: emailConfigured() ? "Set up" : "Postmark isn't set up" });

  // The dispatcher's rounds: without them no check-ins, invoices or follow-ups go out.
  const rounds = await heartbeat("cron_dispatch");
  const roundsAge = rounds ? now - rounds.at : Infinity;
  checks.push({
    key: "rounds",
    label: "Dispatcher's rounds",
    level: roundsAge < 25 * MIN ? "ok" : roundsAge < 60 * MIN ? "warn" : "down",
    detail: rounds ? `Last ran ${ago(roundsAge)}` : "Never ran: check the scheduler (DEPLOY.md, step 5)",
  });

  // Messages waiting on a provider that was down.
  const { count: waiting } = await db.from("outbound").select("id", { head: true, count: "exact" }).eq("status", "retry");
  const { count: gaveUp } = await db.from("outbound").select("id", { head: true, count: "exact" }).eq("status", "gave_up").gte("created_at", hourAgo);
  checks.push({
    key: "outbox",
    label: "Messages waiting to send",
    level: (gaveUp ?? 0) > 0 || (waiting ?? 0) >= 20 ? "down" : (waiting ?? 0) > 0 ? "warn" : "ok",
    detail: `${waiting ?? 0} waiting for a provider${gaveUp ? `, ${gaveUp} given up on in the last hour` : ""}`,
  });

  // The voice server, when it's set up.
  const voice = process.env.VOICE_SERVER_URL;
  if (voice) {
    const url = `${voice.replace(/^ws/, "http").replace(/\/$/, "")}/health`;
    const ok = await fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.ok)
      .catch(() => false);
    checks.push({ key: "voice", label: "Voice server", level: ok ? "ok" : "down", detail: ok ? "Answering" : `No answer from ${url}: calls fall back to turn-by-turn` });
  } else checks.push({ key: "voice", label: "Voice server", level: "off", detail: "Not set up: calls take turns" });

  // The website worker, when it's set up.
  if (portalReady()) {
    const worker = await heartbeat("portal_worker");
    const age = worker ? now - worker.at : Infinity;
    const { data: queued } = await db.from("portal_tasks").select("created_at").eq("status", "queued").order("created_at").limit(1);
    const oldest = queued?.[0] ? now - Date.parse(queued[0].created_at as string) : 0;
    checks.push({
      key: "portal",
      label: "Website worker",
      level: age > 10 * MIN ? "down" : oldest > 15 * MIN ? "warn" : "ok",
      detail: `${worker ? `Last asked for work ${ago(age)}` : "Never checked in"}${oldest ? `; oldest waiting job ${ago(oldest)}` : ""}`,
    });
  } else checks.push({ key: "portal", label: "Website worker", level: "off", detail: "Not set up: support does broker websites" });

  checks.push(await spending(now));
  return checks;
}

/**
 * AI spending today against this month's daily average, per carrier. A carrier using three times its usual (and over
 * $5) is looked at: a loop, a flood of email, or someone abusing the chat.
 */
async function spending(now: number): Promise<Check> {
  const month = new Date(now).toISOString().slice(0, 7);
  const today = new Date(now).toISOString().slice(0, 10);
  const { data } = await admin().from("usage").select("carrier_id, input_tokens, output_tokens").eq("month", month);
  const inPer = price("COST_AI_INPUT_PER_MTOK", 5) / 1e6;
  const outPer = price("COST_AI_OUTPUT_PER_MTOK", 25) / 1e6;
  const totals = Object.fromEntries((data ?? []).map((r) => [r.carrier_id as string, Number(r.input_tokens) * inPer + Number(r.output_tokens) * outPer]));
  // The day's starting point is kept, so today's spend is what was added since.
  const mark = await heartbeat("usage_day");
  if (!mark || mark.data.day !== today) {
    await beat("usage_day", { day: today, start: totals });
    return { key: "spend", label: "AI spending", level: "ok", detail: `$${Object.values(totals).reduce((a, b) => a + b, 0).toFixed(2)} this month so far` };
  }
  const start = (mark.data.start ?? {}) as Record<string, number>;
  const dayOfMonth = new Date(now).getUTCDate();
  const spikes = Object.entries(totals)
    .map(([carrier, total]) => {
      const todaySpend = total - (start[carrier] ?? 0);
      const before = start[carrier] ?? 0;
      const usual = dayOfMonth > 1 ? before / (dayOfMonth - 1) : 0;
      return { carrier, todaySpend, usual };
    })
    .filter((x) => x.todaySpend > 5 && x.todaySpend > 3 * Math.max(x.usual, 1));
  const month$ = Object.values(totals).reduce((a, b) => a + b, 0);
  if (!spikes.length) return { key: "spend", label: "AI spending", level: "ok", detail: `$${month$.toFixed(2)} this month so far` };
  const { data: names } = await admin().from("carriers").select("id, name").in("id", spikes.map((s) => s.carrier));
  const nameOf = (id: string) => (names ?? []).find((n) => n.id === id)?.name ?? id;
  return {
    key: "spend",
    label: "AI spending",
    level: "warn",
    detail: spikes.map((s) => `${nameOf(s.carrier)}: $${s.todaySpend.toFixed(2)} today (usually $${s.usual.toFixed(2)} a day)`).join("; "),
  };
}

/**
 * Checked every round: support hears about anything down (or AI spending running away), once an hour per problem,
 * and once when it's back.
 */
export async function alertOnHealth(now = Date.now()): Promise<string[]> {
  const report = await healthReport(now).catch((e) => [{ key: "health", label: "Health check", level: "down" as Level, detail: String(e?.message ?? e) }]);
  const done: string[] = [];
  const state = await heartbeat("alerts");
  const open = { ...((state?.data ?? {}) as Record<string, number>) };
  // Whoever is on call for the system (ALERT_PHONES), or else the support team's phones.
  const phones = (process.env.ALERT_PHONES ?? process.env.SUPPORT_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const email = process.env.SUPPORT_EMAIL;
  const send = async (text: string) => {
    for (const to of phones) await textTo(null, to, text).catch((e) => console.error("[health] alert text failed", e));
    if (email) await emailOurTeam(email, text.slice(0, 120), text);
  };
  for (const c of report) {
    const bad = c.level === "down" || (c.key === "spend" && c.level === "warn");
    if (bad && (!open[c.key] || now - open[c.key] > 60 * MIN)) {
      await send(`Backroute system alert: ${c.label} is ${c.level === "down" ? "down" : "unusual"}. ${c.detail}`.slice(0, 600));
      open[c.key] = now;
      done.push(`alert: ${c.label}`);
    } else if (!bad && open[c.key]) {
      await send(`Backroute: ${c.label} is working again. ${c.detail}`.slice(0, 600));
      delete open[c.key];
      done.push(`recovered: ${c.label}`);
    }
  }
  await beat("alerts", open);
  return done;
}
