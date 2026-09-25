import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, claude } from "./server";
import { RATE_CON_SYSTEM } from "./prompts";

/** What the carrier agreed on a load, to check a rate con against. */
export const Agreed = z.object({
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
export type AgreedTerms = z.infer<typeof Agreed>;

export const Reading = z.object({
  isRateCon: z.boolean(),
  broker: z.string().nullable(),
  brokerMc: z.string().nullable(),
  brokerEmail: z.string().nullable(),
  loadNumber: z.string().nullable(),
  totalRate: z.number().nullable(),
  originCity: z.string().nullable(),
  originState: z.string().nullable(),
  destinationCity: z.string().nullable(),
  destinationState: z.string().nullable(),
  miles: z.number().nullable(),
  pickup: z.string().nullable(),
  delivery: z.string().nullable(),
  // The appointment (or the start of the window) in the stop's own local time, "YYYY-MM-DDTHH:mm", when the date is on it.
  pickupLocal: z.string().nullable(),
  deliveryLocal: z.string().nullable(),
  equipment: z.string().nullable(),
  detention: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  finesAndFees: z.array(z.string()),
  mismatches: z.array(z.object({ item: z.string(), agreed: z.string(), onDoc: z.string(), serious: z.boolean() })),
  otherConcerns: z.array(z.string()),
  summary: z.string(),
});
export type RateConReading = z.infer<typeof Reading>;

export class ReadError extends Error {
  constructor(public code: "declined" | "unreadable") {
    super(code);
  }
}

/**
 * Reads a rate con PDF. With agreed terms it also lists what doesn't match them; without (a new load being added
 * from its rate con) it only reads the terms.
 */
export async function readRateConPdf(pdf: Buffer, agreed: AgreedTerms | null): Promise<RateConReading> {
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
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          {
            type: "text",
            text: agreed
              ? `What the carrier agreed:\n${JSON.stringify(agreed, null, 2)}`
              : "Nothing was agreed yet: this rate con is how the load is being added. Read the terms, leave mismatches empty, and still list fees and concerns.",
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new ReadError("declined");
  const reading = response.parsed_output;
  if (!reading) throw new ReadError("unreadable");

  // A rate that doesn't match is the costliest miss, so it's also checked here, not only by the model.
  const rateFlagged = reading.mismatches.some((m) => /rate|pay|total|amount/i.test(m.item));
  if (agreed && reading.totalRate != null && Math.abs(reading.totalRate - agreed.rate) >= 1 && !rateFlagged) {
    reading.mismatches.unshift({
      item: "Rate",
      agreed: `$${agreed.rate.toLocaleString()}`,
      onDoc: `$${reading.totalRate.toLocaleString()}`,
      serious: reading.totalRate < agreed.rate,
    });
  }
  return reading;
}
