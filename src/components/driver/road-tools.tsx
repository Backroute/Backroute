"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CloudLightning, Copy, HandCoins, Navigation, ParkingSquare, Wind } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { tripState } from "@/lib/trip-state";
import { cityCoords, pickupLegStart, type LatLng } from "@/lib/trip-geo";
import { DEFAULT_PROFILE, heightWords, NAV_APPS, navApp, profileWords } from "@/lib/nav-apps";
import { clockWords, hosNow, samplePoints, whereHoursEnd } from "@/lib/hos-clock";
import { requestLumper } from "@/lib/lumper";
import { updateTruck } from "@/lib/back-office";
import { haptic } from "@/lib/feedback";
import { cn, formatCurrency } from "@/lib/utils";
import type { Driver, Load, NavApp, Truck } from "@/lib/types";

interface Alert {
  event: string;
  headline: string;
  severity: string;
}

/** Under this, a trailer is light enough for a crosswind to tip: empty, or a light load. */
const LIGHT_LBS = 15000;

/**
 * Everything on the road in one card: directions in the driver's truck GPS, when the hours run out and where to
 * park, weather along the way, and lumper money at the dock.
 */
export function RoadTools({ load, truck, driver }: { load: Load; truck: Truck; driver: Driver }) {
  const now = useNow();
  const s = tripState(load, now, false);
  const pickup = s.card === "pickup";
  const stop = pickup ? { city: load.lane.origin, state: load.lane.originState } : { city: load.lane.destination, state: load.lane.destState };
  const to = cityCoords(stop.city, stop.state);
  const from: LatLng | undefined = pickup ? pickupLegStart(load, truck.currentCity, truck.currentState) : cityCoords(load.lane.origin, load.lane.originState);
  const [sheet, setSheet] = useState<"directions" | "lumper" | null>(null);
  if (s.card === "booking") return null;

  const hos = now !== null ? hosNow(driver, now) : null;
  const left = hos ? Math.min(hos.drive, hos.shift) : null;
  const end = from && to && left !== null && !s.arrived ? whereHoursEnd(from, to, s.legP, left) : null;
  const app = navApp(driver.prefs?.navApp);
  const label = `${stop.city}, ${stop.state}`;

  return (
    <section aria-labelledby="road-title" className="flex flex-col gap-3 rounded-3xl border border-line p-4">
      <h2 id="road-title" className="t-label text-ink-500">
        On the road
      </h2>
      <div className="grid grid-cols-2 gap-2">
        <a
          href={app.link({ at: to, label })}
          onClick={() => haptic("tap")}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ink-950 px-3 text-sm font-semibold text-white"
        >
          <Navigation className="h-4 w-4" /> {app.name.replace(" Truck", "")}
        </a>
        <button type="button" onClick={() => setSheet("directions")} className="min-h-12 rounded-2xl border border-line px-3 text-sm font-medium text-ink-800">
          Other apps &amp; truck size
        </button>
      </div>
      {!app.truckSafe && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--accent-warn)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {app.name} routes like a car: it doesn&apos;t know your height or weight. Watch for low bridges, or switch to a truck app.
        </p>
      )}

      {hos && end && <HoursAndParking driver={driver} hos={hos} end={end} now={now!} />}

      {from && to && <RouteWeather from={from} to={to} progress={s.legP} light={!load.weight || load.weight < LIGHT_LBS || s.card === "pickup"} loadKey={`${load.id}:${s.card}`} />}

      <LumperRow load={load} driver={driver} onAsk={() => setSheet("lumper")} />

      <Sheet open={sheet === "directions"} onClose={() => setSheet(null)} title="Directions" description={`To ${label}`}>
        <DirectionsSheet driver={driver} truck={truck} to={to} label={label} onDone={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === "lumper"} onClose={() => setSheet(null)} title="Lumper money" description="Dispatch sends a payment code to give the lumper service.">
        <LumperForm load={load} driver={driver} onDone={() => setSheet(null)} />
      </Sheet>
    </section>
  );
}

function DirectionsSheet({ driver, truck, to, label, onDone }: { driver: Driver; truck: Truck; to?: LatLng; label: string; onDone: () => void }) {
  const setDriverPrefs = useStore((s) => s.actions.setDriverPrefs);
  const profile = truck.profile ?? DEFAULT_PROFILE;
  const [edit, setEdit] = useState(false);
  const [p, setP] = useState(profile);
  return (
    <div className="flex flex-col gap-4 pb-2">
      <ul className="flex flex-col gap-2">
        {NAV_APPS.map((a) => (
          <li key={a.id}>
            <a
              href={a.link({ at: to, label })}
              onClick={() => {
                setDriverPrefs(driver.id, { ...driver.prefs, navApp: a.id as NavApp });
                onDone();
              }}
              className={cn("flex items-center justify-between rounded-2xl border px-4 py-3 text-sm", driver.prefs?.navApp === a.id ? "border-brand bg-brand-soft" : "border-line")}
            >
              <span className="font-medium text-ink-950">{a.name}</span>
              <span className={cn("text-xs", a.truckSafe ? "text-[var(--accent-live)]" : "text-ink-500")}>{a.truckSafe ? "Truck routing" : "Car routing"}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-500">The one you pick opens next time from the big button.</p>
      <div className="rounded-2xl bg-ink-50 p-4 text-sm">
        <p className="font-medium text-ink-950">Your truck</p>
        <p className="mt-0.5 text-ink-600">{profileWords(profile)}</p>
        <p className="mt-1 text-xs text-ink-500">Set the same in your truck GPS app once, so it routes around low bridges and weight limits.</p>
        {edit ? (
          <form
            className="mt-3 grid grid-cols-2 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              updateTruck(truck.id, { profile: p });
              setEdit(false);
            }}
          >
            <label className="text-xs text-ink-600">
              Height (inches)
              <input type="number" inputMode="numeric" min={120} max={170} value={p.heightIn} onChange={(e) => setP({ ...p, heightIn: Number(e.target.value) })} className="mt-1 h-9 w-full rounded-full border border-line bg-white px-3 text-sm" />
              <span className="text-ink-400">{heightWords(p.heightIn)}</span>
            </label>
            <label className="text-xs text-ink-600">
              Weight (lbs)
              <input type="number" inputMode="numeric" min={10000} max={140000} step={1000} value={p.weightLbs} onChange={(e) => setP({ ...p, weightLbs: Number(e.target.value) })} className="mt-1 h-9 w-full rounded-full border border-line bg-white px-3 text-sm" />
            </label>
            <label className="text-xs text-ink-600">
              Length (ft)
              <input type="number" inputMode="numeric" min={20} max={120} value={p.lengthFt} onChange={(e) => setP({ ...p, lengthFt: Number(e.target.value) })} className="mt-1 h-9 w-full rounded-full border border-line bg-white px-3 text-sm" />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-xs text-ink-600">
              <input type="checkbox" checked={p.hazmat} onChange={(e) => setP({ ...p, hazmat: e.target.checked })} /> Hazmat
            </label>
            <Button size="sm" type="submit" className="col-span-2">
              Save
            </Button>
          </form>
        ) : (
          <button type="button" onClick={() => setEdit(true)} className="mt-2 text-xs font-medium text-ink-950 underline">
            Change
          </button>
        )}
      </div>
    </div>
  );
}

const RESERVE = [
  { name: "Truck Parking Club", url: "https://truckparkingclub.com" },
  { name: "TA Petro", url: "https://www.ta-petro.com" },
  { name: "Pilot Flying J", url: "https://pilotflyingj.com" },
  { name: "Love's", url: "https://www.loves.com" },
];

function HoursAndParking({ driver, hos, end, now }: { driver: Driver; hos: ReturnType<typeof hosNow>; end: ReturnType<typeof whereHoursEnd>; now: number }) {
  const left = Math.min(hos.drive, hos.shift);
  const stopAt = new Date(now + left * 3600_000);
  const hour = stopAt.getHours();
  // After about 5 PM most lots near cities and on the interstates are full; before dawn they're still full.
  const late = !end.reachesStop && (hour >= 17 || hour < 6);
  const search = `https://www.google.com/maps/search/truck+stop/@${end.at[0].toFixed(3)},${end.at[1].toFixed(3)},10z`;
  return (
    <div className="rounded-2xl bg-ink-50 p-3.5 text-sm">
      <p className="flex items-center gap-2 font-medium text-ink-950">
        <ParkingSquare className="h-4 w-4 text-ink-500" />
        {end.reachesStop ? `You make the stop with ${clockWords(left - end.miles / 50)} to spare` : `Hours run out in about ${end.miles} miles`}
      </p>
      <p className="mt-0.5 text-xs text-ink-500">
        Drive {clockWords(hos.drive)} · shift {clockWords(hos.shift)}
        {hos.cycle !== null ? ` · cycle ${clockWords(hos.cycle)}` : ""}
        {hos.fromEld ? "" : " · from the app, no ELD"}
      </p>
      {!end.reachesStop && (
        <>
          {late && (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-[var(--accent-warn)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> That&apos;s around {stopAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}, when lots fill up. Reserve a spot, or stop early.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <a href={search} target="_blank" rel="noreferrer" className="rounded-full bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white">
              Truck stops there
            </a>
            {RESERVE.map((r) => (
              <a key={r.name} href={r.url} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-800">
                {r.name}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RouteWeather({ from, to, progress, light, loadKey }: { from: LatLng; to: LatLng; progress: number; light: boolean; loadKey: string }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  // Points along the rest of the leg, rounded, so the request (and its cache) only changes every few miles.
  const pts = samplePoints(from, to, Math.round(progress * 10) / 10);
  const query = pts.map((p) => `${p[0]},${p[1]}`).join(";");
  useEffect(() => {
    let off = false;
    fetch(`/api/weather/route?pts=${encodeURIComponent(query)}`)
      .then((r) => (r.ok ? r.json() : { points: [] }))
      .then((d: { points: { alerts: Alert[] }[] }) => {
        if (off) return;
        const seen = new Set<string>();
        setAlerts(d.points.flatMap((p) => p.alerts).filter((a) => (seen.has(a.event) ? false : (seen.add(a.event), true))));
      })
      .catch(() => !off && setAlerts([]));
    return () => {
      off = true;
    };
  }, [query, loadKey]);
  if (!alerts?.length) return null;
  const windy = alerts.some((a) => /wind/i.test(a.event));
  return (
    <div className="rounded-2xl border border-[var(--accent-warn)]/40 bg-warn-soft p-3.5 text-sm" role="status">
      <p className="flex items-center gap-2 font-medium text-ink-950">
        <CloudLightning className="h-4 w-4 text-[var(--accent-warn)]" /> Weather on your route
      </p>
      <ul className="mt-1 flex flex-col gap-1 text-xs text-ink-700">
        {alerts.slice(0, 4).map((a) => (
          <li key={a.event}>
            <span className="font-medium">{a.event}</span> · {a.headline}
          </li>
        ))}
      </ul>
      {windy && light && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-[var(--accent-danger)]">
          <Wind className="mt-0.5 h-3.5 w-3.5 shrink-0" /> High wind with a light trailer can tip it. Slow down, or park it out until the wind drops; dispatch will tell the broker.
        </p>
      )}
    </div>
  );
}

function LumperRow({ load, driver, onAsk }: { load: Load; driver: Driver; onAsk: () => void }) {
  const asks = useStore((s) => s.expenses).filter((e) => e.upfront && e.driverId === driver.id && e.loadId === load.id);
  const latest = asks[0];
  const [copied, setCopied] = useState(false);
  if (latest?.status === "approved" && latest.payCode)
    return (
      <div className="rounded-2xl bg-live-soft p-3.5">
        <p className="text-xs font-medium text-[var(--accent-live)]">Lumper approved: {formatCurrency(latest.amount)}. Give them this code:</p>
        <p className="mt-1 font-mono text-2xl font-semibold tracking-wider text-ink-950">{latest.payCode}</p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(latest.payCode!);
            setCopied(true);
            haptic("tap");
          }}
          className="mt-1 flex items-center gap-1 text-xs font-medium text-ink-700"
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
    );
  if (latest?.status === "pending")
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-ink-50 px-3.5 py-3 text-sm text-ink-700" role="status">
        <HandCoins className="h-4 w-4 text-ink-500" /> Asked for {formatCurrency(latest.amount)} lumper money. The code shows here when dispatch sends it.
      </p>
    );
  return (
    <button type="button" onClick={onAsk} className="flex min-h-11 items-center gap-2 rounded-2xl border border-line px-3.5 text-sm font-medium text-ink-800">
      <HandCoins className="h-4 w-4 text-ink-500" /> Need lumper money?
      {latest?.status === "denied" && <span className="ml-auto text-xs text-[var(--accent-danger)]">Last ask was turned down</span>}
    </button>
  );
}

function LumperForm({ load, driver, onDone }: { load: Load; driver: Driver; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const atPickup = ["dispatched", "at_pickup"].includes(load.stage);
  const [facility, setFacility] = useState(atPickup ? `Shipper in ${load.lane.origin}` : `Receiver in ${load.lane.destination}`);
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-3 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(amount);
        if (!(n > 0)) return;
        requestLumper(driver.id, load.id, n, facility, note);
        haptic("success");
        onDone();
      }}
    >
      <label className="text-sm text-ink-700">
        How much they want
        <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="$ 0" className="mt-1 h-12 w-full rounded-2xl border border-line px-4 text-lg tabular outline-none focus:border-ink-400" />
      </label>
      <label className="text-sm text-ink-700">
        Where
        <input value={facility} onChange={(e) => setFacility(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-line px-4 text-sm outline-none focus:border-ink-400" />
      </label>
      <label className="text-sm text-ink-700">
        Anything else (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pallet count, who to pay…" className="mt-1 h-11 w-full rounded-2xl border border-line px-4 text-sm outline-none focus:border-ink-400" />
      </label>
      <Button type="submit" disabled={!(Number(amount) > 0)}>
        Ask for the code
      </Button>
      <p className="text-xs text-ink-500">Keep the lumper receipt and snap it with the BOL or POD: it goes on the broker&apos;s invoice.</p>
    </form>
  );
}
