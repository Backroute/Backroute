import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { cancelTask, portalReady, resume, taskById, tasksFor, updateTask, viewOf } from "@/lib/portal/tasks";
import { forget, listVault, saveAnswer, saveLogin, seal, siteOf, totpCode } from "@/lib/portal/vault";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save_login"), site: z.string().trim().min(3).max(300), label: z.string().trim().max(120).optional(), username: z.string().trim().min(1).max(200), password: z.string().min(1).max(300), totp: z.string().trim().max(120).optional() }),
  z.object({ op: z.literal("forget"), id: z.string().min(1).max(300) }),
  z.object({ op: z.literal("approve"), taskId: z.string().min(1) }),
  z.object({ op: z.literal("stop"), taskId: z.string().min(1) }),
  z.object({ op: z.literal("retry"), taskId: z.string().min(1) }),
  z.object({ op: z.literal("answer"), taskId: z.string().min(1), answer: z.string().max(500).optional(), username: z.string().max(200).optional(), password: z.string().max(300).optional() }),
]);

/**
 * The owner's side of the AI's work on other companies' websites: the logins it uses (added here, never shown back),
 * its jobs, and the answers it waits on (submit this setup? what's your EIN?). Passwords and the 2-step key only go
 * in; nothing here sends one back out.
 */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const ctx = await loadContext(who.me.carrierId);
  if (!ctx) return Response.json({ error: "not_found" }, { status: 404 });
  // One job, for its card on Needs you.
  const one = new URL(request.url).searchParams.get("task");
  if (one) {
    const task = await taskById(one);
    if (!task || task.carrier_id !== ctx.carrier.id) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ task: viewOf(task, ctx.loads), question: task.data.question?.key });
  }
  const [vault, tasks] = await Promise.all([listVault(ctx.carrier.id).catch(() => ({ logins: [], answers: [] })), tasksFor(ctx.carrier.id)]);
  return Response.json({ ready: portalReady(), ...vault, tasks: tasks.map((t) => viewOf(t, ctx.loads)) });
}

export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  const carrierId = who.me.carrierId;
  const owner = who.me.role === "owner";
  const by = who.me.userId;
  if (!portalReady()) return Response.json({ error: "portal_off" }, { status: 503 });

  if (b.op === "save_login" || b.op === "forget") {
    // The carrier's passwords are the owner's to give.
    if (!owner) return Response.json({ error: "owner_only" }, { status: 403 });
    if (b.op === "forget") {
      await forget(carrierId, b.id);
      return Response.json({ ok: true });
    }
    if (!siteOf(b.site)) return Response.json({ error: "bad_site" }, { status: 400 });
    if (b.totp && !totpCode(b.totp)) return Response.json({ error: "bad_totp" }, { status: 400 });
    const site = await saveLogin(carrierId, { site: b.site, label: b.label, username: b.username, password: b.password, totp: b.totp || null, by });
    return Response.json({ ok: true, site });
  }

  const task = await taskById(b.taskId);
  if (!task || task.carrier_id !== carrierId) return Response.json({ error: "not_found" }, { status: 404 });

  if (b.op === "stop") return Response.json({ ok: true, status: (await cancelTask(task, "the owner")).status });
  if (b.op === "retry") {
    if (task.status !== "failed") return Response.json({ error: "not_failed" }, { status: 409 });
    const again = await updateTask(task, { status: "queued", worker: null, locked_until: null, attempts: 0 }, { note: undefined, parked: false });
    return Response.json({ ok: true, status: again.status });
  }
  if (b.op === "approve") {
    if (task.status !== "needs_approval") return Response.json({ error: "nothing_to_approve" }, { status: 409 });
    const next = await resume(task, { approvedAt: new Date().toISOString(), approvedBy: by, pending: undefined });
    return Response.json({ ok: true, status: next.status });
  }

  // An answer to the website's question.
  if (task.status !== "needs_answer" || !task.data.question) return Response.json({ error: "nothing_asked" }, { status: 409 });
  const key = task.data.question.key;
  if (key.startsWith("login:")) {
    if (!owner) return Response.json({ error: "owner_only" }, { status: 403 });
    if (!b.username?.trim() || !b.password) return Response.json({ error: "bad_request" }, { status: 400 });
    await saveLogin(carrierId, { site: key.slice(6), username: b.username, password: b.password, by });
    return Response.json({ ok: true, status: (await resume(task, {})).status });
  }
  if (key === "one_time_code") {
    const code = b.answer?.replace(/\s+/g, "");
    if (!code) return Response.json({ error: "bad_request" }, { status: 400 });
    return Response.json({ ok: true, status: (await resume(task, { code: { sealed: seal(code, `${carrierId}|code|${task.id}`), at: new Date().toISOString(), from: "owner" } })).status });
  }
  if (key.startsWith("paper_")) return Response.json({ ok: true, status: (await resume(task, {})).status });
  if (!b.answer?.trim()) return Response.json({ error: "bad_request" }, { status: 400 });
  await saveAnswer(carrierId, { key, label: task.data.question.text, value: b.answer.trim(), by });
  return Response.json({ ok: true, status: (await resume(task, {})).status });
}
