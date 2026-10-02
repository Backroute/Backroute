"use client";

import { useState } from "react";
import { Camera, Loader2, Plus, Trash2 } from "lucide-react";
import { authHeader } from "@/lib/ai/client";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { toE164 } from "@/lib/cloud/phone";
import { RUN_TYPE_LABEL, RUN_TYPES } from "@/lib/run-types";
import type { FleetEntry } from "@/lib/fleet";
import type { EquipmentType } from "@/lib/types";

const EQUIPMENT: EquipmentType[] = ["Dry Van", "Reefer", "Flatbed", "Container"];

const blank = (): FleetEntry => ({ driverName: "", phone: "", unitNumber: "", equipment: "Dry Van", homeCity: "", homeState: "", runType: "regional" });

const problem = (e: FleetEntry) =>
  !e.driverName.trim()
    ? "Add the driver's name."
    : !toE164(e.phone)
      ? "Add the driver's cell number: the AI texts and calls it, and they sign in with it."
      : !e.unitNumber.trim()
        ? "Add the truck's unit number."
        : !e.homeCity.trim() || !/^[A-Za-z]{2}$/.test(e.homeState.trim())
          ? "Add the home base city and its 2-letter state."
          : null;

/**
 * Trucks and drivers, typed in: one row per truck and the driver who runs it. An owner-operator gets one row with
 * their own name and number. ELD import comes later; until then this is how a real fleet gets into Backroute.
 */
export function FleetForm({ solo, submitLabel, onSubmit, busy }: { solo: boolean; submitLabel: string; onSubmit: (entries: FleetEntry[]) => void; busy?: boolean }) {
  const [rows, setRows] = useState<FleetEntry[]>([blank()]);
  const [tried, setTried] = useState(false);
  const real = useStore((s) => s.session.mode !== "demo");
  const [reading, setReading] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  // Rows the photo was hard to read in: the owner looks twice before saving.
  const [unsure, setUnsure] = useState<Set<number>>(new Set());

  async function fromPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setPhotoNote(null);
    try {
      const form = new FormData();
      form.set("photo", file);
      const res = await fetch("/api/import/fleet-photo", { method: "POST", headers: await authHeader(), body: form });
      const body = (await res.json()) as { isFleetList?: boolean; rows?: { unitNumber: string; driverName: string; phone: string; equipment: string; homeCity: string; homeState: string; sure: boolean }[]; error?: string };
      if (!res.ok || !body.rows) throw new Error(body.error ?? "read");
      if (!body.isFleetList || !body.rows.length) return setPhotoNote("That doesn't look like a list of trucks or drivers. Try a clearer photo, or type them in.");
      const read = body.rows.map((r) => ({ ...blank(), driverName: r.driverName, phone: r.phone, unitNumber: r.unitNumber, equipment: (EQUIPMENT as string[]).includes(r.equipment) ? (r.equipment as EquipmentType) : "Dry Van", homeCity: r.homeCity, homeState: r.homeState }));
      setRows(solo ? read.slice(0, 1) : read);
      setUnsure(new Set(body.rows.map((r, i) => (r.sure ? -1 : i)).filter((i) => i >= 0)));
      setTried(true);
      setPhotoNote(`Read ${read.length} row${read.length === 1 ? "" : "s"} from the photo. Check them, fill in anything missing, then save.`);
    } catch {
      setPhotoNote("Couldn't read the photo. Try again, or type them in.");
    } finally {
      setReading(false);
    }
  }
  const errors = rows.map(problem);
  const set = (i: number, patch: Partial<FleetEntry>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const input = "min-w-0 rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (errors.every((x) => !x)) onSubmit(rows);
      }}
      className="flex flex-col gap-3"
    >
      {real && (
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-50">
            {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {reading ? "Reading the photo…" : "Fill in from a photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={reading} onChange={(e) => void fromPhoto(e.target.files?.[0])} />
          </label>
          <p className="text-xs text-ink-600">{photoNote ?? "A picture of your whiteboard, a printed list or a spreadsheet on screen. You check everything before it's saved."}</p>
        </div>
      )}
      {rows.map((row, i) => (
        <fieldset key={i} className={unsure.has(i) ? "rounded-2xl border border-[var(--accent-warn)] p-3" : "rounded-2xl border border-line p-3"}>
          <legend className="px-1 text-xs font-medium text-ink-500">{solo ? "You and your truck" : `Truck ${i + 1}`}</legend>
          <div className="grid grid-cols-2 gap-2">
            <input className={input} placeholder={solo ? "Your name" : "Driver's name"} aria-label="Driver's name" value={row.driverName} onChange={(e) => set(i, { driverName: e.target.value })} />
            <input className={input} placeholder="Cell number" aria-label="Driver's cell number" type="tel" inputMode="tel" value={row.phone} onChange={(e) => set(i, { phone: e.target.value })} />
            <input className={input} placeholder="Truck unit #" aria-label="Truck unit number" value={row.unitNumber} onChange={(e) => set(i, { unitNumber: e.target.value })} />
            <select className={input} aria-label="Equipment" value={row.equipment} onChange={(e) => set(i, { equipment: e.target.value as EquipmentType })}>
              {EQUIPMENT.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
            <div className="col-span-2 grid grid-cols-[1fr_4.5rem_auto] gap-2">
              <input className={input} placeholder="Home base city" aria-label="Home base city" value={row.homeCity} onChange={(e) => set(i, { homeCity: e.target.value })} />
              <input className={input} placeholder="State" aria-label="Home base state" maxLength={2} value={row.homeState} onChange={(e) => set(i, { homeState: e.target.value.toUpperCase() })} />
              <select className={input} aria-label="How they run" value={row.runType} onChange={(e) => set(i, { runType: e.target.value as FleetEntry["runType"] })}>
                {RUN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RUN_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {unsure.has(i) && <p className="mt-2 text-xs text-[var(--accent-warn)]">Hard to read in the photo: check this one.</p>}
          {tried && errors[i] && <p className="mt-2 text-xs text-[var(--accent-danger)]">{errors[i]}</p>}
          {!solo && rows.length > 1 && (
            <button type="button" onClick={() => setRows((r) => r.filter((_, n) => n !== i))} className="mt-2 flex items-center gap-1 text-xs text-ink-500 hover:text-[var(--accent-danger)]">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </fieldset>
      ))}
      {!solo && (
        <button type="button" onClick={() => setRows((r) => [...r, blank()])} className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line py-2.5 text-sm font-medium text-ink-600 hover:border-ink-300">
          <Plus className="h-4 w-4" /> Another truck
        </button>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
