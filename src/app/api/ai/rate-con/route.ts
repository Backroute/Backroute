import Anthropic from "@anthropic-ai/sdk";
import { authorize, deny, json } from "@/lib/ai/server";
import { Agreed, ReadError, readRateConPdf } from "@/lib/ai/rate-con-reader";

const MAX_BYTES = 10 * 1024 * 1024;

/** Reads a rate confirmation PDF, and checks it against what was agreed on the load when that's given. */
export async function POST(request: Request) {
  const access = await authorize(request);
  if (!access.ok) return deny(access);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const agreedRaw = form?.get("agreed");
  const agreed = agreedRaw ? Agreed.safeParse(JSON.parse(String(agreedRaw))) : null;
  if (!(file instanceof File) || (agreed && !agreed.success)) return json({ error: "bad_request" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "too_large" }, 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return json({ error: "not_pdf" }, 415);

  try {
    return json({ reading: await readRateConPdf(bytes, agreed?.success ? agreed.data : null) });
  } catch (error) {
    if (error instanceof ReadError) return json({ error: error.code }, error.code === "declined" ? 422 : 502);
    if (error instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (error instanceof Anthropic.APIError) return json({ error: "ai_error", status: error.status }, 502);
    return json({ error: "unreachable" }, 502);
  }
}
