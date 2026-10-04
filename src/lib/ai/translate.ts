import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, FALLBACK, aiConfigured, claude } from "./server";

/**
 * Our emails to a broker, in the broker's language (a Quebec broker writing in French, a Mexican one in Spanish). The
 * AI translates the email the rules already wrote; then code checks that every amount, load number, MC number and
 * address came through exactly as written. If anything is missing, the English goes instead: a price is never at the
 * mercy of a translation.
 */

const SYSTEM = (language: string) => `Translate this email from a trucking dispatcher into ${language}. Keep it just as short, plain and friendly, the way a dispatcher who speaks ${language} would write it. Copy exactly, character for character: every dollar amount (like $1,600), every number, load reference, MC number, email address, web address, company and person name, and the signature lines. Output only the translated email, nothing else.`;

/** The pieces that must come through untouched: money, numbers, references, addresses. */
function mustKeep(text: string): string[] {
  const keep = new Set<string>();
  for (const m of text.matchAll(/\$[\d,]+(?:\.\d{2})?|\b[A-Z]{2,}-?\d[\w-]*|\S+@\S+\.\w+|https?:\/\/\S+|\b\d[\d,]*(?:\.\d+)?\b/g)) keep.add(m[0].replace(/[.,;:)]+$/, ""));
  return [...keep].filter(Boolean);
}

const NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** The email in the broker's language, or null (send the English) if it can't be done safely. */
export async function translateEmail(body: string, lang: string): Promise<string | null> {
  if (!aiConfigured() || !lang || lang === "en") return null;
  let language: string;
  try {
    language = NAMES.of(lang) ?? "";
  } catch {
    return null;
  }
  if (!language) return null;
  try {
    const message = await claude().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 3000,
      ...FALLBACK,
      output_config: { effort: "low" },
      system: SYSTEM(language),
      messages: [{ role: "user", content: body }],
    });
    if (message.stop_reason === "refusal") return null;
    const out = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return out && mustKeep(body).every((k) => out.includes(k)) ? out : null;
  } catch (error) {
    console.error("[translate] failed", error instanceof Anthropic.APIError ? error.status : error);
    return null;
  }
}

const FOR_DRIVER = (language: string) => `Translate these short notes for a truck driver into ${language}, the way a dispatcher who speaks ${language} would say them: short and plain. Keep every number, time, door or gate number, and place or company name exactly as written. Output only the translation.`;

/** A driver's notes (dock tips, reefer settings) in their language, or the English when that can't be done safely. */
export async function translateForDriver(text: string, lang: string): Promise<string> {
  if (!text || !aiConfigured() || !lang || lang === "en") return text;
  const language = NAMES.of(lang);
  if (!language) return text;
  try {
    const message = await claude().beta.messages.create({ model: AI_MODEL, max_tokens: 1000, ...FALLBACK, output_config: { effort: "low" }, system: FOR_DRIVER(language), messages: [{ role: "user", content: text }] });
    const out = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return out && mustKeep(text).every((k) => out.includes(k)) ? out : text;
  } catch (error) {
    console.error("[translate] driver note failed", error instanceof Anthropic.APIError ? error.status : error);
    return text;
  }
}
