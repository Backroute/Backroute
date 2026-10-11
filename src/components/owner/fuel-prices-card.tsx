"use client";

import { useRef, useState } from "react";
import { Fuel, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { askConfirm } from "@/components/ui/ask-host";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { cheapestByState, keepCheapest, parsePriceFile } from "@/lib/fuel-prices";
import { formatDate } from "@/lib/utils";

/**
 * The fuel card's station prices (the network price list WEX, Comdata, EFS, AtoB and others publish), so each trip's
 * fuel plan names the cheapest stop the card covers in each state on the way. Without it, a real account gets no plan.
 */
export function FuelPricesCard() {
  const prices = useStore((s) => s.settings.fuelPrices);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const file = useRef<HTMLInputElement>(null);
  const now = useNow();
  const [source, setSource] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function read(f: File | undefined) {
    if (!f) return;
    const parsed = parsePriceFile(await f.text());
    if ("error" in parsed) return setMsg({ ok: false, text: parsed.error });
    const kept = keepCheapest(parsed.stations);
    updateSettings({ fuelPrices: { source: source.trim() || f.name.replace(/\.[a-z]+$/i, ""), at: new Date().toISOString(), stations: kept } });
    const states = new Set(kept.map((s) => s.state)).size;
    setMsg({ ok: true, text: `${parsed.stations.length} stations read in ${states} state${states === 1 ? "" : "s"}${parsed.skipped ? `, ${parsed.skipped} without a state or price skipped` : ""}. Fuel plans use them from now.` });
  }

  const best = prices ? Object.values(cheapestByState(prices.stations)).sort((a, b) => a.price - b.price) : [];
  return (
    <Card id="fuel-prices" className="scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Fuel className="h-4 w-4" /> Fuel prices from your card
          </CardTitle>
          <CardDescription>
            Upload your fuel card&apos;s station price list (CSV) and each trip&apos;s fuel plan names the cheapest stop your card covers in each state on the
            way, at your card&apos;s price. Most cards publish it daily on their site.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 !pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Which card" className="min-w-0 rounded-full border border-line bg-white px-3 py-1.5 text-sm" placeholder="Which card (e.g. WEX)" value={source} onChange={(e) => setSource(e.target.value)} />
          <input ref={file} type="file" accept=".csv,text/csv,.txt" className="hidden" aria-label="Fuel price file" onChange={(e) => void read(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
          <Button size="sm" onClick={() => file.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> {prices ? "Upload a newer list" : "Upload the price list"}
          </Button>
          {prices && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (await askConfirm("Remove the fuel prices?", "Trips stop showing a fuel plan until a new list is uploaded.", "Remove", true)) {
                  updateSettings({ fuelPrices: undefined });
                  setMsg(null);
                }
              }}
            >
              Remove
            </Button>
          )}
        </div>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-ink-700" : "text-[var(--accent-danger)]"}`}>{msg.text}</p>}
        {prices && (
          <div>
            <p className="text-xs text-ink-500">
              {prices.source}, {formatDate(prices.at)} · cheapest by state
            </p>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {best.slice(0, 10).map((s) => (
                <li key={s.state} className="flex justify-between gap-3">
                  <span className="truncate text-ink-700">
                    {s.state} · {s.name}
                    {s.city ? `, ${s.city}` : ""}
                  </span>
                  <span className="tabular text-ink-950">${s.price.toFixed(3)}</span>
                </li>
              ))}
            </ul>
            {now !== null && now - Date.parse(prices.at) > 3 * 86400_000 && <p className="mt-2 text-xs text-[var(--accent-warn)]">These are more than 3 days old; prices move daily.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
