import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, authorize, claude, deny, json } from "@/lib/ai/server";
import { RATE_CON_SYSTEM } from "@/lib/ai/prompts";

const Agreed = z.object({
  broker: z.string().max(200),
  rate: z.number().nonnegative(),
  origin: z.string().max(200),
  destination: z.string().max(200),
  pickup: z.string().max(200),
  delivery: z.string().max(200),
  equipment: z.string().max(100),
  detention: z.string().max(200),
  paymentTerms: z.string().max(100),
});

const Reading = z.object({
  isRateCon: z.boolean(),
  broker: z.string().nullable(),
  brokerMc: z.string().nullable(),
  loadNumber: z.string().nullable(),
  totalRate: z.number().nullable(),
  pickup: z.string().nullable(),
  delivery: z.string().nullable(),
  equipment: z.string().nullable(),
  detention: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  finesAndFees: z.array(z.string()),
  mismatches: z.array(z.object({ item: z.string(), agreed: z.string(), onDoc: z.string(), serious: z.boolean() })),
  otherConcerns: z.array(z.string()),
  summary: z.string(),
});

const MAX_BYTES = 10 * 1024 * 1024;

/** Reads a rate confirmation PDF and checks it against what was agreed on the load. */
export async function POST(request: Request) {
  const access = await authorize(request);
  if (!access.ok) return deny(access);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const agreed = Agreed.safeParse(JSON.parse(String(form?.get("agreed") ?? "null")));
  if (!(file instanceof File) || !agreed.success) return json({ error: "bad_request" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "too_large" }, 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return json({ error: "not_pdf" }, 415);

  try {
    const response = await claude().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "high", format: betaZodOutputFormat(Reading) },
      system: RATE_CON_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } },
            { type: "text", text: `What the carrier agreed:\n${JSON.stringify(agreed.data, null, 2)}` },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return json({ error: "declined" }, 422);
    const reading = response.parsed_output;
    if (!reading) return json({ error: "unreadable" }, 502);

    // A rate that doesn't match is the costliest miss, so it's also checked here, not only by the model.
    const rateFlagged = reading.mismatches.some((m) => /rate|pay|total|amount/i.test(m.item));
    if (reading.totalRate != null && Math.abs(reading.totalRate - agreed.data.rate) >= 1 && !rateFlagged) {
      reading.mismatches.unshift({
        item: "Rate",
        agreed: `$${agreed.data.rate.toLocaleString()}`,
        onDoc: `$${reading.totalRate.toLocaleString()}`,
        serious: reading.totalRate < agreed.data.rate,
      });
    }
    return json({ reading });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (error instanceof Anthropic.APIError) return json({ error: "ai_error", status: error.status }, 502);
    return json({ error: "unreachable" }, 502);
  }
}
