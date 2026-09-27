import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, claude } from "../ai/server";

const Offer = z.object({
  loadNumber: z.string().nullable(),
  originCity: z.string().nullable(),
  originState: z.string().nullable(),
  destinationCity: z.string().nullable(),
  destinationState: z.string().nullable(),
  pickup: z.string().nullable(),
  delivery: z.string().nullable(),
  pickupLocal: z.string().nullable(),
  deliveryLocal: z.string().nullable(),
  equipment: z.string().nullable(),
  rate: z.number().nullable(),
  miles: z.number().nullable(),
  weight: z.number().nullable(),
  notes: z.string().nullable(),
});

const Reading = z.object({
  kind: z.enum(["load_offers", "rate_reply", "setup_request", "payment", "cancellation", "change_request", "appointment", "other"]),
  offers: z.array(Offer),
  brokerRate: z.number().nullable(),
  agreedToOurRate: z.boolean(),
  loadNumber: z.string().nullable(),
  contactName: z.string().nullable(),
  brokerCompany: z.string().nullable(),
  brokerMc: z.string().nullable(),
  brokerPhone: z.string().nullable(),
  payments: z.array(z.object({ reference: z.string(), amount: z.number().nullable(), paidOn: z.string().nullable() })),
  cancelReason: z.string().nullable(),
  brokerRpm: z.number().nullable(),
  question: z.string().nullable(),
  language: z.string().nullable(),
  changeKind: z.enum(["add_stop", "reroute"]).nullable(),
  changePlaces: z.array(z.object({ city: z.string(), state: z.string() })),
  appointmentStop: z.enum(["pickup", "delivery"]).nullable(),
  appointmentLocal: z.string().nullable(),
  appointmentConfirmation: z.string().nullable(),
});
export type BrokerMailReading = z.infer<typeof Reading>;
export type OfferReading = z.infer<typeof Offer>;

const system = (today: string) => `You read email that freight brokers send a small trucking carrier, and pull out the facts. You never reply; code decides what to do with what you find.

Pick the kind:
- load_offers: the broker is offering or listing loads the carrier could haul (one load or a list). Put each load in offers.
- rate_reply: the broker is answering the carrier's price on a load: agreeing to it, or naming their own number. Set agreedToOurRate, and brokerRate to the all-in total the broker names now (null if they don't name one).
- setup_request: the broker wants the carrier's setup paperwork (W-9, insurance certificate, authority, a carrier packet).
- payment: a payment or remittance notice (ACH, check, quick pay). Put each load or invoice it pays in payments: reference is the load or invoice number as written, amount what was paid for it, paidOn as YYYY-MM-DD.
- cancellation: the broker is cancelling a load that was booked. Set loadNumber, and cancelReason in a few words.
- appointment: on a load already booked, the broker gives a pickup or delivery appointment time they set (or moved). Set loadNumber, appointmentStop, appointmentLocal as YYYY-MM-DDTHH:mm in the stop's local time, and appointmentConfirmation if they give a number.
- change_request: on a load already booked, the broker adds a stop (changeKind add_stop, changePlaces the new stops in order) or sends the truck somewhere else (changeKind reroute, changePlaces the one new delivery). Set loadNumber.
- other: anything else.

Only report what the email says; use null for anything it doesn't. Rates are all-in totals in US dollars (if the email gives a rate per mile and the miles, multiply). For pickupLocal and deliveryLocal give YYYY-MM-DDTHH:mm in the stop's local time, only when the email shows the date (today is ${today}). States are two-letter codes. loadNumber is the broker's load or reference number the email is about. contactName is the sender's first name if they sign it. brokerCompany, brokerMc and brokerPhone are the brokerage's name, MC number and the sender's phone number as written in the email or signature, null if not there. brokerRpm is a rate per mile the broker names without the miles (e.g. "2.80 a mile"), else null. language is the two-letter ISO code of the language the email is written in (en, fr, es...). changeKind is null and changePlaces empty unless kind is change_request; the appointment fields are null unless kind is appointment. question is anything the broker asks besides the price (where the truck is, when it can get there, the MC, equipment, anything else), in a short sentence; null if they don't ask.`;

/** What a broker's email is and the facts in it. Null when the AI isn't available or declines. */
export async function readBrokerEmail(subject: string, text: string): Promise<BrokerMailReading | null> {
  try {
    const response = await claude().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 6000,
      ...FALLBACK,
      output_config: { effort: "low", format: betaZodOutputFormat(Reading) },
      system: system(new Date().toISOString().slice(0, 10)),
      messages: [{ role: "user", content: `Subject: ${subject}\n\n${text}` }],
    });
    if (response.stop_reason === "refusal") return null;
    return response.parsed_output ?? null;
  } catch (error) {
    console.error("[email] couldn't read the broker's email", error);
    return null;
  }
}
