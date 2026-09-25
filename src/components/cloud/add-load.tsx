"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authHeader, readRateCon } from "@/lib/ai/client";
import { estimateMiles } from "@/lib/fleet";
import { useStore } from "@/lib/store";
import type { EquipmentType, RateConPdfReading } from "@/lib/types";

const EQUIPMENT: EquipmentType[] = ["Dry Van", "Reefer", "Flatbed", "Container"];

interface Form {
  truckId: string;
  brokerName: string;
  brokerEmail: string;
  referenceNumber: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  miles: string;
  pickupWindow: string;
  deliveryWindow: string;
  rate: string;
  equipment: EquipmentType;
}

const guessEquipment = (text: string | null): EquipmentType | null =>
  !text ? null : /reefer|refrig/i.test(text) ? "Reefer" : /flat/i.test(text) ? "Flatbed" : /container|chassis/i.test(text) ? "Container" : /van/i.test(text) ? "Dry Van" : null;

/**
 * A load the owner booked: typed in, or filled in from the broker's rate con PDF by the AI (it reads the terms, the
 * owner checks them and picks the truck). The load goes straight to the driver's app, and they get a text about it.
 */
export function AddLoadButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen((o) => !o)}>
        {open ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {open ? "Close" : "Add a load"}
      </Button>
      {open && <AddLoadPanel onDone={() => setOpen(false)} />}
    </>
  );
}

function AddLoadPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const trucks = useStore((s) => s.trucks);
  const drivers = useStore((s) => s.drivers);
  const addLoad = useStore((s) => s.actions.addLoad);
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<RateConPdfReading | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [f, setF] = useState<Form>({
    truckId: trucks.find((t) => !t.currentLoadId)?.id ?? trucks[0]?.id ?? "",
    brokerName: "",
    brokerEmail: "",
    referenceNumber: "",
    originCity: "",
    originState: "",
    destinationCity: "",
    destinationState: "",
    miles: "",
    pickupWindow: "",
    deliveryWindow: "",
    rate: "",
    equipment: trucks[0]?.equipmentType ?? "Dry Van",
  });
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));

  async function fromPdf(file: File) {
    setBusy(file.name);
    setNote(null);
    const result = await readRateCon(file, null);
    setBusy(null);
    if (!result.ok) return setNote(result.reason === "off" ? "Reading PDFs needs the live AI, which isn't switched on. Type the load in instead." : "Couldn't read that PDF. Type the load in instead.");
    const r = result.reading;
    if (!r.isRateCon) return setNote("That doesn't look like a rate con. Type the load in instead.");
    const readAt = new Date().toISOString();
    setReading({ ...r, fileName: file.name, readAt });
    setF((x) => ({
      ...x,
      brokerName: r.broker ?? x.brokerName,
      brokerEmail: r.brokerEmail ?? x.brokerEmail,
      referenceNumber: r.loadNumber ?? x.referenceNumber,
      originCity: r.originCity ?? x.originCity,
      originState: r.originState ?? x.originState,
      destinationCity: r.destinationCity ?? x.destinationCity,
      destinationState: r.destinationState ?? x.destinationState,
      miles: r.miles ? String(Math.round(r.miles)) : x.miles,
      pickupWindow: r.pickup ?? x.pickupWindow,
      deliveryWindow: r.delivery ?? x.deliveryWindow,
      rate: r.totalRate != null ? String(r.totalRate) : x.rate,
      equipment: guessEquipment(r.equipment) ?? x.equipment,
    }));
    setNote(`Filled in from ${file.name}. Check it, pick the truck, and add it.`);
  }

  const rate = Number(f.rate.replace(/[$,\s]/g, ""));
  const estimate = estimateMiles({ city: f.originCity, state: f.originState }, { city: f.destinationCity, state: f.destinationState });
  const missing = [
    !f.truckId && "the truck",
    !f.brokerName.trim() && "the broker",
    (!f.originCity.trim() || !/^[A-Za-z]{2}$/.test(f.originState.trim())) && "pickup city and state",
    (!f.destinationCity.trim() || !/^[A-Za-z]{2}$/.test(f.destinationState.trim())) && "delivery city and state",
    !f.pickupWindow.trim() && "pickup time",
    !f.deliveryWindow.trim() && "delivery time",
    !(rate > 0) && "the rate",
    !f.miles && !estimate && "the miles",
  ].filter(Boolean);

  function submit() {
    setTried(true);
    if (missing.length) return;
    const load = addLoad({
      truckId: f.truckId,
      brokerName: f.brokerName,
      brokerEmail: f.brokerEmail || null,
      referenceNumber: f.referenceNumber,
      originCity: f.originCity,
      originState: f.originState,
      destinationCity: f.destinationCity,
      destinationState: f.destinationState,
      miles: f.miles ? Number(f.miles) : undefined,
      pickupWindow: f.pickupWindow,
      deliveryWindow: f.deliveryWindow,
      rate,
      equipment: f.equipment,
      rateConReading: reading ?? undefined,
    });
    // The driver gets a text about it (when texting is switched on). Fire and forget: the load is added either way.
    void authHeader().then((headers) =>
      fetch("/api/agent/notify-load", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ loadId: load.id }) }).catch(() => {}),
    );
    onDone();
    router.push(`/carrier/loads/${load.id}`);
  }

  const input = "min-w-0 rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400";
  const driverOf = (id: string | null) => drivers.find((d) => d.id === id)?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/30 px-4 py-10" role="dialog" aria-modal="true" aria-label="Add a load">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-ink-950">Add a load</h2>
            <p className="mt-0.5 text-sm text-ink-500">Upload the broker&apos;s rate con and the AI fills this in, or type it.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onDone} className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <Button className="mt-4 w-full" variant="outline" disabled={!!busy} onClick={() => fileInput.current?.click()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />} {busy ? `Reading ${busy}…` : "Fill in from the rate con PDF"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label="Rate con PDF for the new load"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void fromPdf(file);
          }}
        />
        {note && <p className="mt-2 text-xs text-ink-600">{note}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-ink-700">
            Truck
            <select className={input} value={f.truckId} onChange={(e) => set({ truckId: e.target.value })}>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.unitNumber} · {driverOf(t.driverId) ?? "no driver"}
                  {t.currentLoadId ? " (on a load: this becomes the next one)" : ""}
                </option>
              ))}
            </select>
          </label>
          <input className={input} placeholder="Broker" aria-label="Broker" value={f.brokerName} onChange={(e) => set({ brokerName: e.target.value })} />
          <input className={input} placeholder="Broker email (optional)" aria-label="Broker email" type="email" value={f.brokerEmail} onChange={(e) => set({ brokerEmail: e.target.value })} />
          <input className={input} placeholder="Load / reference #" aria-label="Load number" value={f.referenceNumber} onChange={(e) => set({ referenceNumber: e.target.value })} />
          <input className={input} placeholder="Rate, all in ($)" aria-label="Rate" inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} />
          <div className="col-span-2 grid grid-cols-[1fr_4.5rem] gap-2">
            <input className={input} placeholder="Pickup city" aria-label="Pickup city" value={f.originCity} onChange={(e) => set({ originCity: e.target.value })} />
            <input className={input} placeholder="State" aria-label="Pickup state" maxLength={2} value={f.originState} onChange={(e) => set({ originState: e.target.value.toUpperCase() })} />
          </div>
          <input className={`${input} col-span-2`} placeholder="Pickup date and time" aria-label="Pickup date and time" value={f.pickupWindow} onChange={(e) => set({ pickupWindow: e.target.value })} />
          <div className="col-span-2 grid grid-cols-[1fr_4.5rem] gap-2">
            <input className={input} placeholder="Delivery city" aria-label="Delivery city" value={f.destinationCity} onChange={(e) => set({ destinationCity: e.target.value })} />
            <input className={input} placeholder="State" aria-label="Delivery state" maxLength={2} value={f.destinationState} onChange={(e) => set({ destinationState: e.target.value.toUpperCase() })} />
          </div>
          <input className={`${input} col-span-2`} placeholder="Delivery date and time" aria-label="Delivery date and time" value={f.deliveryWindow} onChange={(e) => set({ deliveryWindow: e.target.value })} />
          <input className={input} placeholder={estimate ? `Miles (about ${estimate})` : "Miles"} aria-label="Miles" inputMode="numeric" value={f.miles} onChange={(e) => set({ miles: e.target.value.replace(/\D/g, "") })} />
          <select className={input} aria-label="Equipment" value={f.equipment} onChange={(e) => set({ equipment: e.target.value as EquipmentType })}>
            {EQUIPMENT.map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
        </div>

        {tried && missing.length > 0 && <p className="mt-3 text-xs text-[var(--accent-danger)]">Still needed: {missing.join(", ")}.</p>}
        <Button className="mt-4 w-full" onClick={submit}>
          <Plus className="h-4 w-4" /> Add the load
        </Button>
        <p className="mt-2 text-center text-[11px] text-ink-400">It goes to the driver&apos;s app right away, and they get a text about it when texting is on. Fuel and profit are estimates.</p>
      </div>
    </div>
  );
}
