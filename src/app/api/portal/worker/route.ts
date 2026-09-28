import crypto from "node:crypto";
import { z } from "zod";
import { dbConfigured, storeFile } from "@/lib/agent/db";
import { portalStep } from "@/lib/portal/step";
import { claimNext, giveUpOn, portalReady, taskById, updateTask } from "@/lib/portal/tasks";
import { beat } from "@/lib/health";

export const maxDuration = 60;

const Element = z.object({
  i: z.number().int(),
  tag: z.string().max(40),
  type: z.string().max(40).optional(),
  role: z.string().max(40).optional(),
  label: z.string().max(400),
  value: z.string().max(400).optional(),
  checked: z.boolean().optional(),
  options: z.array(z.string().max(200)).max(200).optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
const Page = z.object({
  url: z.string().max(4000),
  title: z.string().max(500),
  text: z.string().max(40000),
  elements: z.array(Element).max(600),
  screenshot: z.string().max(3_000_000).optional(),
});
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("next"), worker: z.string().min(1).max(100) }),
  z.object({
    op: z.literal("step"),
    worker: z.string().min(1).max(100),
    taskId: z.string().min(1),
    page: Page,
    last: z
      .object({ ok: z.boolean(), error: z.string().max(1000).optional(), download: z.object({ name: z.string().max(300), contentType: z.string().max(100), base64: z.string().max(14_000_000) }).optional() })
      .nullable(),
  }),
  z.object({ op: z.literal("finish"), worker: z.string().min(1).max(100), taskId: z.string().min(1), note: z.string().max(1000), screenshot: z.string().max(3_000_000).optional() }),
]);

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The browser worker's side (portal-worker/): take the next job, send each page for the next step, and say when
 * the browser itself failed. Only the worker can call it: it signs with PORTAL_WORKER_SECRET, and a job answers only
 * to the worker holding it.
 */
export async function POST(request: Request) {
  if (!dbConfigured() || !portalReady()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const secret = process.env.PORTAL_WORKER_SECRET!;
  const auth = request.headers.get("authorization") ?? "";
  if (!same(auth, `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;

  if (b.op === "next") {
    await beat("portal_worker", { worker: b.worker });
    const task = await claimNext(b.worker);
    return Response.json({ task: task ? { id: task.id, kind: task.kind, url: task.url } : null });
  }

  const task = await taskById(b.taskId);
  if (!task || task.worker !== b.worker) return Response.json({ action: { do: "finish", outcome: "stopped", note: "not yours" } });

  if (b.op === "step") return Response.json({ action: await portalStep(task, b.page, b.last) });

  // The browser failed (the page wouldn't load, it crashed, it timed out): tried again from the link, up to three
  // times, then support.
  if (["done", "failed", "cancelled"].includes(task.status)) return Response.json({ ok: true });
  const shot = b.screenshot ? await storeFile(task.carrier_id, { kind: "portal_screenshot", name: "website-error.jpg", contentType: "image/jpeg", bytes: Buffer.from(b.screenshot, "base64"), loadId: task.load_id, note: b.note.slice(0, 300) }).catch(() => undefined) : undefined;
  if (task.attempts < 3 && task.status === "running") await updateTask(task, { status: "queued", worker: null, locked_until: null }, { note: b.note, steps: [...(task.data.steps ?? []), { at: new Date().toISOString(), url: task.url, action: "restart", error: b.note.slice(0, 200), ok: false }] });
  else if (task.status === "running") await giveUpOn(task, b.note, shot);
  return Response.json({ ok: true });
}
