"use client";

import { useState } from "react";
import { Navigation, ParkingSquare } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/ai/client";
import { navApp } from "@/lib/nav-apps";
import { haptic } from "@/lib/feedback";
import type { Driver, ParkingReservation, ParkingSpot, Truck } from "@/lib/types";

type Found = { spots: ParkingSpot[]; where: string | null; arrive?: string; booked: ParkingReservation | null };

/**
 * Reserving a parking spot from the driver's screen, signed in. Only what the driver taps: the AI never books one on
 * its own. Shows the spot that's booked (the driver's or the owner's ask), with the way there in the truck app.
 */
export function ParkingReserve({ truck, driver }: { truck: Truck; driver: Driver }) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [state, setState] = useState<"idle" | "looking" | "booking" | "off" | "down">("idle");
  // What this screen just booked or cancelled, until the truck's record catches up from the server.
  const [mine, setBooked] = useState<{ r: ParkingReservation | null; id?: string } | null>(null);
  const fromServer = truck.parking?.status === "booked" ? truck.parking : null;
  const booked = mine ? (mine.r ?? (fromServer && fromServer.id !== mine.id ? fromServer : null)) : fromServer;
  const app = navApp(driver.prefs?.navApp);

  async function look() {
    setOpen(true);
    setState("looking");
    try {
      const res = await fetch("/api/parking", { headers: await authHeader(), cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503 && body.error === "parking_off") return setState("off");
      if (!res.ok) return setState("down");
      setFound(body as Found);
      setState("idle");
    } catch {
      setState("down");
    }
  }

  async function book(spot: ParkingSpot) {
    setState("booking");
    haptic("tap");
    try {
      const res = await fetch("/api/parking", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ spotId: spot.id }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok || body.error === "already_booked") {
        setBooked({ r: body.booked });
        setOpen(false);
        haptic("success");
        setState("idle");
        return;
      }
      if (body.error === "gone") return look();
      setState("down");
    } catch {
      setState("down");
    }
  }

  async function cancel() {
    const res = await fetch("/api/parking", { method: "DELETE", headers: await authHeader() }).catch(() => null);
    if (res?.ok) setBooked({ r: null, id: booked?.id });
  }

  if (booked)
    return (
      <div className="mt-2 rounded-2xl border border-line bg-white p-3">
        <p className="text-xs font-medium text-ink-500">Parking reserved{booked.askedBy === "owner" ? " (by the office)" : ""}</p>
        <p className="mt-0.5 font-semibold text-ink-950">{booked.place}</p>
        <p className="text-xs text-ink-600">
          {booked.address} · #{booked.confirmation} · ${booked.price}
        </p>
        {booked.checkIn && <p className="mt-1 text-xs text-ink-700">{booked.checkIn}</p>}
        <div className="mt-2 flex gap-2">
          <a href={app.link({ at: [booked.lat, booked.lon], label: booked.place })} className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink-950 px-3 text-xs font-semibold text-white">
            <Navigation className="h-3.5 w-3.5" /> {app.name}
          </a>
          <button type="button" onClick={cancel} className="min-h-10 rounded-xl border border-line px-3 text-xs font-medium text-ink-700">
            Cancel spot
          </button>
        </div>
      </div>
    );

  return (
    <>
      <button type="button" onClick={look} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 px-3 text-sm font-semibold text-white">
        <ParkingSquare className="h-4 w-4" /> Reserve a spot
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Reserve parking" description={found?.where ? `Spots ${found.where}` : "Spots where you'll stop tonight"}>
        {state === "looking" && <p className="text-sm text-ink-500">Looking for spots…</p>}
        {state === "off" && <p className="text-sm text-ink-600">Reserving from the app isn&apos;t set up for your fleet. Use your truck stop app, or ask dispatch in Messages.</p>}
        {state === "down" && <p className="text-sm text-ink-600">The parking service didn&apos;t answer. Nothing was booked. Try again in a minute.</p>}
        {(state === "idle" || state === "booking") && found && !found.spots.length && <p className="text-sm text-ink-600">No spots to reserve near there. Your truck stop app may show more.</p>}
        {(state === "idle" || state === "booking") && found && found.spots.length > 0 && (
          <ul className="flex flex-col gap-2">
            {found.spots.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-950">{s.name}</p>
                  <p className="truncate text-xs text-ink-500">
                    {s.address}
                    {s.miles !== undefined ? ` · ${s.miles} mi` : ""}
                  </p>
                </div>
                <Button size="sm" disabled={state === "booking"} onClick={() => book(s)}>
                  Book ${s.price}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-500">Paid by your company. Only booked when you tap Book.</p>
      </Sheet>
    </>
  );
}
