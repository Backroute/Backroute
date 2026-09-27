import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Item } from "../cloud/rows";
import type { Load } from "../types";
import { save, storeFile, type CarrierContext } from "./db";

/**
 * Signing the broker's rate con, the way a dispatcher does before the truck rolls: the broker's own pages, then a
 * signature page with the load, the agreed rate and the terms, signed with the name of the person the owner
 * authorized in Settings (Your rules → Rate cons) and when. Only for a rate con that matched what was agreed, on a load
 * the AI booked. Without an authorized signer it doesn't sign. Brokers who want it signed in their own portal
 * (DocuSign and the like) get a person: the AI doesn't log in to other companies' systems.
 */

export const PORTAL_SIGNING = /\b(docusign|hellosign|adobe ?sign|pandadoc|e-?sign(ature)?|sign (it )?(here|online|electronically)|click (here )?to (sign|accept)|accept (the )?(load|rate con(firmation)?) (online|in|at|through))\b/i;

const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");

export async function signRateCon(ctx: CarrierContext, load: Load, original: Buffer, contentType: string, now = new Date()): Promise<{ fileId: string; name: string } | null> {
  const signer = ctx.settings.rateConSigner;
  if (!signer?.name?.trim()) return null;

  let doc: PDFDocument;
  try {
    if (contentType === "application/pdf") doc = await PDFDocument.load(original, { ignoreEncryption: true });
    else {
      // A photo of the rate con: its own page first.
      doc = await PDFDocument.create();
      const img = contentType === "image/png" ? await doc.embedPng(original) : await doc.embedJpg(original);
      const scale = Math.min(572 / img.width, 752 / img.height, 1);
      const page = doc.addPage([612, 792]);
      page.drawImage(img, { x: (612 - img.width * scale) / 2, y: (792 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    }
  } catch (e) {
    console.error("[sign] couldn't open the rate con", e);
    return null;
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const script = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const page = doc.addPage([612, 792]);
  let y = 730;
  const line = (text: string, o: { size?: number; f?: typeof font; gap?: number } = {}) => {
    y -= (o.gap ?? 0) + (o.size ?? 11) * 1.45;
    page.drawText(clean(text), { x: 56, y, size: o.size ?? 11, font: o.f ?? font, color: rgb(0.1, 0.1, 0.1) });
  };
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const rate = load.bookRequest?.ask ?? load.bookedRate ?? load.targetRate;
  const at = now.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }) + " CT";
  line("Carrier signature: rate confirmation accepted", { size: 16, f: bold });
  line(`Load ${load.referenceNumber}${broker ? ` with ${broker.company}` : ""}`, { gap: 10 });
  line(`${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState}`);
  line(`Pickup: ${load.pickupWindow}     Delivery: ${load.deliveryWindow}`);
  line(`Agreed rate: $${rate.toLocaleString("en-US")} all in`, { f: bold });
  line(`Detention: $${ctx.settings.detentionPerHour ?? 50}/hour after 2 hours free. TONU: $${ctx.settings.tonuFee ?? 150}.`);
  line(`Carrier: ${ctx.carrier.name}${ctx.carrier.mc ? `, ${/mc/i.test(ctx.carrier.mc) ? ctx.carrier.mc : `MC ${ctx.carrier.mc}`}` : ""}`, { gap: 10 });
  line("Accepted and signed:", { gap: 24 });
  line(signer.name, { size: 22, f: script, gap: 8 });
  page.drawLine({ start: { x: 56, y: y - 6 }, end: { x: 330, y: y - 6 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });
  line(`${signer.name}${signer.title ? `, ${signer.title}` : ""}, for ${ctx.carrier.name}`, { gap: 10 });
  line(`Signed ${at}`);
  line("Signed electronically through Backroute on the carrier's authorization. The pages before this one are the", { size: 8, gap: 18 });
  line("broker's rate confirmation as received; the carrier accepts it as written.", { size: 8 });

  const bytes = Buffer.from(await doc.save());
  const name = `${load.referenceNumber || "rate-con"}-signed.pdf`.replace(/[^\w.-]+/g, "-");
  const fileId = await storeFile(ctx.carrier.id, { kind: "rate_con_signed", name, contentType: "application/pdf", bytes, loadId: load.id, note: `Signed by ${signer.name}` });
  // On the load as it is now (the tracking request or anything else saved since the caller read it stays).
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  const signed: Load = { ...current, rateConSignedAt: now.toISOString(), rateConSignedBy: signer.name, updatedAt: now.toISOString() };
  await save("loads", ctx.carrier.id, signed as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? signed : l));
  return { fileId, name };
}
