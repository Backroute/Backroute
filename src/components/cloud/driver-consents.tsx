"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/ai/client";
import { OWNER_ATTESTS } from "@/lib/consent-words";
import { usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";

interface Latest {
  granted: boolean;
  via: "app" | "sms" | "whatsapp" | "voice" | "owner";
  at: string;
}

const HOW: Record<Latest["via"], string> = { app: "in the driver app", sms: "by text", whatsapp: "on WhatsApp", voice: "on a call", owner: "you said they agreed" };

/**
 * Each driver's consent to texts and calls, as recorded: agreed in the app, by text, or by the owner when hiring
 * them; or STOP. A driver with nothing on record gets the first text that says who's texting and how to stop.
 */
export function DriverConsentsCard() {
  const drivers = useStore((s) => s.drivers);
  const carrier = usePrimaryCarrier();
  const [data, setData] = useState<Record<string, Latest> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/consent", { headers: await authHeader() });
      if (!res.ok) throw new Error("load");
      setData(((await res.json()) as { drivers: Record<string, Latest> }).drivers);
    } catch {
      setError("Couldn't load consent records. Check your connection.");
    }
  }, []);

  useEffect(() => {
    // Loading the records is an effect of opening the card; what it sets comes back from the network.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function attest(driverId: string) {
    setBusy(driverId);
    setError(null);
    try {
      const res = await fetch("/api/consent", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ op: "attest", driverIds: [driverId] }) });
      if (!res.ok) throw new Error("save");
      await refresh();
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Drivers&apos; OK to texts and calls</CardTitle>
        <CardDescription>
          Each yes and STOP is kept on record. A driver with nothing on record gets a first text saying who&apos;s texting and how to stop, and can agree in the driver app.
        </CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-2">
        {drivers.length === 0 && <p className="text-sm text-ink-500">No drivers yet.</p>}
        {drivers.map((d) => {
          const c = data?.[d.id];
          return (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">{d.name}</p>
                <p className="text-xs text-ink-500">{!data ? "…" : c ? `${c.granted ? "Agreed" : "Said no"} ${HOW[c.via]}, ${new Date(c.at).toLocaleDateString()}` : "Nothing on record yet"}</p>
              </div>
              {data && (!c || !c.granted) ? (
                <Button size="sm" variant="outline" disabled={busy === d.id} title={OWNER_ATTESTS(carrier.name)} onClick={() => void attest(d.id)}>
                  They agreed
                </Button>
              ) : (
                data && <Badge tone="success">On record</Badge>
              )}
            </div>
          );
        })}
        {error && <p className="text-xs text-[var(--accent-danger)]">{error}</p>}
      </CardContent>
    </Card>
  );
}
