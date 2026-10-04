import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, claude } from "./server";

/**
 * A photo of the fleet as the owner keeps it (a whiteboard, a printed sheet, a spreadsheet on a screen) read into
 * trucks and drivers, for the owner to check and save. Only what's written there: nothing guessed. Each row says how
 * sure the reading is, so the owner looks twice at the unsure ones.
 */

const Row = z.object({
  unitNumber: z.string().describe("The truck's unit or number as written; empty if none"),
  driverName: z.string().describe("The driver's name as written; empty if none"),
  phone: z.string().describe("The driver's phone as written; empty if none"),
  equipment: z.enum(["Dry Van", "Reefer", "Flatbed", "Container", "unknown"]),
  homeCity: z.string().describe("Where the truck or driver is based, city only; empty if not written"),
  homeState: z.string().describe("Two-letter state or province for homeCity; empty if not written"),
  sure: z.boolean().describe("False when the handwriting or picture made any field in this row hard to read"),
});
const Reading = z.object({
  isFleetList: z.boolean().describe("False if the picture isn't a list of trucks or drivers"),
  rows: z.array(Row),
});
type FleetRow = z.infer<typeof Row>;

const SYSTEM = `You read a photo of a small trucking company's fleet list: a whiteboard, a printed sheet or a spreadsheet on a screen. Return one row per truck (with its driver) or per driver, with only what's written there. Never invent a phone number, name, unit or city; leave a field empty when it isn't written or can't be read. Map trailer words to equipment: van/dry van/53' → Dry Van, reefer/refrigerated → Reefer, flatbed/step deck → Flatbed, container/chassis/day cab → Container, else unknown. Mark a row not sure when anything in it was hard to read.`;

export async function readFleetPhoto(image: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<{ isFleetList: boolean; rows: FleetRow[] }> {
  const response = await claude().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(Reading) },
    system: SYSTEM,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } }, { type: "text", text: "Read this fleet list." }] }],
  });
  const out = response.parsed_output;
  if (!out) return { isFleetList: false, rows: [] };
  // Phone numbers only as written: digits that make a real US/Canada number, else left for the owner.
  const rows = out.rows.slice(0, 100).map((r) => {
    const digits = r.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    return { ...r, phone: digits.length === 10 ? digits : "", homeState: r.homeState.toUpperCase().slice(0, 2) };
  });
  return { isFleetList: out.isFleetList, rows };
}
