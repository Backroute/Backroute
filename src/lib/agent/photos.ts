import "server-only";
import { aiConfigured } from "../ai/server";
import { checkStopDocument } from "../ai/doc-check";
import { twilioMedia } from "../channels/twilio";
import type { Item } from "../cloud/rows";
import type { Driver, Load, LoadDocument, Truck } from "../types";
import { addActivity, admin, save, type CarrierContext } from "./db";
import { event, passToOwner, uid } from "./dispatcher";

/**
 * A driver texts a photo instead of opening the app: the BOL at pickup, the signed POD at delivery, a lumper receipt.
 * It's stored and checked like an upload in the app, goes on their current load, and a clean POD closes the delivery
 * (so the invoice can go out). What it is comes from what they wrote, or else from where the load is.
 */

type StopDoc = "bol" | "pod" | "lumper_receipt";
const NAMES: Record<StopDoc, string> = { bol: "bill of lading", pod: "signed POD", lumper_receipt: "lumper receipt" };

export function whichDocument(text: string, load: Pick<Load, "stage">): StopDoc {
  if (/\b(lumper|receipt|unload(ing)? fee)\b/i.test(text)) return "lumper_receipt";
  if (/\b(bol|b\.o\.l|bill of lading|loaded|pick ?up)\b/i.test(text)) return "bol";
  if (/\b(pod|proof|delivered|signed|empty now|unloaded)\b/i.test(text)) return "pod";
  return ["dispatched", "at_pickup"].includes(load.stage) ? "bol" : "pod";
}

export async function driverPhotos(ctx: CarrierContext, driver: Driver, media: { url: string }[], text: string): Promise<string> {
  const truck = ctx.trucks.find((t) => t.id === driver.truckId || t.secondDriverId === driver.id);
  const load =
    ctx.loads.find((l) => l.id === truck?.currentLoadId) ??
    ctx.loads.find((l) => l.truckId && l.truckId === truck?.id && ["dispatched", "at_pickup", "in_transit", "at_delivery"].includes(l.stage));
  if (!load) {
    await passToOwner(ctx, { reason: `${driver.name} texted ${media.length} photo${media.length === 1 ? "" : "s"}${text ? ` ("${text}")` : ""}, but has no load on the go to put it on.`, label: "Got it", source: "sms", to: "owner" });
    return "Got the photo, thanks. I don't see a load on your truck right now, so I passed it to the office.";
  }
  const kind = whichDocument(text, load);
  const said: string[] = [];
  let current = load;
  for (const [i, m] of media.entries()) {
    const file = await twilioMedia(m.url).catch(() => null);
    if (!file) {
      said.push("One photo didn't come through; send it again or use the app.");
      continue;
    }
    const check = aiConfigured() ? await checkStopDocument(kind, file.bytes, file.contentType, load.referenceNumber).catch(() => null) : null;
    const flagged = !!check && (!check.isExpectedDocument || (kind !== "lumper_receipt" && !check.signed) || check.exceptions.length > 0);
    const note = check ? (check.exceptions.length ? `${check.note} Noted on it: ${check.exceptions.join("; ")}.` : check.note) : null;
    const amount = kind === "lumper_receipt" && check?.amount && check.amount > 0 && check.amount < 5000 ? Math.round(check.amount * 100) / 100 : undefined;
    const name = `${load.referenceNumber}-${kind}${media.length > 1 ? `-${i + 1}` : ""}.${file.contentType.split("/")[1] ?? "jpg"}`;
    const { data: row, error } = await admin()
      .from("carrier_files")
      .insert({ carrier_id: ctx.carrier.id, kind, load_id: load.id, name, content_type: file.contentType, size: file.bytes.length, data: file.bytes.toString("base64"), note })
      .select("id")
      .single();
    if (error) throw error;
    const doc: LoadDocument = { id: uid("doc"), type: kind, name, generatedAt: new Date().toISOString(), status: "verified", flagged, fileId: row.id as string, uploadedBy: "driver", ...(amount ? { amount } : {}), ...(note ? { aiNote: note } : {}) } as LoadDocument;
    current = { ...current, documents: [...current.documents.filter((d) => !(d.type === kind && kind !== "lumper_receipt")), doc], updatedAt: new Date().toISOString() };
    if (flagged) {
      await passToOwner(ctx, { reason: `${driver.name} texted the ${NAMES[kind]} for ${load.referenceNumber}, and it needs a look: ${note ?? "the AI couldn't read it."}`, loadId: load.id, label: "Checked", source: "sms", to: "owner" });
      said.push(`Got the ${NAMES[kind]}, but ${check && !check.signed && kind !== "lumper_receipt" ? "I don't see a signature on it" : "something on it needs a look"}. If you can, get it signed and send another photo.`);
    } else said.push(`Got the ${NAMES[kind]} for ${load.referenceNumber}${amount ? ` ($${amount})` : ""}, thanks.`);
  }
  // A clean POD finishes the delivery, same as the driver swiping it in the app.
  const pod = current.documents.find((d) => d.type === "pod" && d.fileId && !d.flagged);
  if (kind === "pod" && pod && ["in_transit", "at_delivery"].includes(current.stage)) {
    const at = new Date().toISOString();
    current = { ...current, stage: "delivered", progressPct: 100, ticksInStage: 0, tripChecklist: { ...current.tripChecklist, arrivedDeliveryAt: current.tripChecklist?.arrivedDeliveryAt ?? at, unloadedAt: current.tripChecklist?.unloadedAt ?? at } };
    if (truck && truck.currentLoadId === load.id) {
      const next: Truck = { ...truck, currentLoadId: truck.nextLoadId ?? null, nextLoadId: null, status: truck.nextLoadId ? "on_load" : "available" };
      await save("trucks", ctx.carrier.id, next as unknown as Item);
      ctx.trucks = ctx.trucks.map((t) => (t.id === next.id ? next : t));
    }
    said.push("Marked delivered. The invoice goes out with it.");
  }
  await save("loads", ctx.carrier.id, current as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === current.id ? current : l));
  await addActivity(ctx.carrier.id, event({ type: "document_captured", loadId: load.id, message: `${driver.name.split(" ")[0]} texted the ${NAMES[kind]}`, detail: `${load.referenceNumber}${current.stage === "delivered" && load.stage !== "delivered" ? " · delivered" : ""}`, severity: "success" }));
  return said.join(" ");
}
