import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, claude } from "./server";

const Check = z.object({
  isExpectedDocument: z.boolean(),
  signed: z.boolean(),
  exceptions: z.array(z.string()),
  loadNumberSeen: z.string().nullable(),
  note: z.string(),
  amount: z.number().nullable().describe("A lumper receipt: the total paid, in dollars. Otherwise null."),
  readable: z.enum(["clear", "hard", "unreadable"]).describe("Can a broker's billing clerk read it: clear; hard (some parts blurry, cut off or in shadow); unreadable."),
  retakeTip: z.string().nullable().describe("When it isn't clear: one short tip for a better photo (closer, flash, flat on a surface, all four corners). Otherwise null."),
});
type DocCheck = z.infer<typeof Check>;

const WHAT = { bol: "bill of lading (BOL)", pod: "proof of delivery (POD, usually the signed BOL from the receiver)", lumper_receipt: "lumper receipt" };

/**
 * Looks at a driver's photo (or PDF) of a stop document the way a dispatcher would before billing: is it the right
 * document, is it signed, and did anyone write in a shortage, damage or refusal.
 */
export async function checkStopDocument(kind: keyof typeof WHAT, bytes: Buffer, contentType: string, loadRef: string): Promise<DocCheck | null> {
  const media = contentType === "application/pdf" ? "application/pdf" : (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType) ? contentType : null);
  if (!media) return null;
  const file =
    media === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: bytes.toString("base64") } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: media as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: bytes.toString("base64") } };
  const response = await claude().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(Check) },
    system:
      "You check trucking paperwork before it's billed. Say whether the file is the expected document, whether it's signed, and list any exceptions written on it (shortage, overage, damage, refused, 'subject to count'). Only report what you can see; say how readable it is (a broker won't pay on a photo their clerk can't read), and if it isn't clear, one tip for a better photo. Keep the note to one sentence. For a lumper receipt, give the total paid.",
    messages: [{ role: "user", content: [file, { type: "text", text: `Expected: the ${WHAT[kind]} for load ${loadRef}.` }] }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}
