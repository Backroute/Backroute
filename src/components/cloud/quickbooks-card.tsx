"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authHeader } from "@/lib/ai/client";

interface Qbo {
  status: string | null;
  name?: string | null;
  lastSync?: string | null;
}

const RESULT: Record<string, string> = {
  connected: "QuickBooks is connected. The first entries go in within the hour.",
  cancelled: "Not connected: QuickBooks was closed before it finished.",
  expired: "That took too long. Start again.",
  failed: "QuickBooks didn't let us in. Try again.",
  off: "QuickBooks isn't available yet.",
};

/**
 * QuickBooks Online, kept in step by the AI: invoices sent to brokers, their payments, and costs (fuel, tolls, what
 * drivers paid at docks) go in on their own every hour. Owner only.
 */
export function QuickbooksCard() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [qbo, setQbo] = useState<Qbo | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | "off" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations", { headers: await authHeader() });
      if (!res.ok) return;
      const data = (await res.json()) as { connections: ({ kind: string } & Qbo)[]; available?: { quickbooks?: boolean } };
      setAvailable(!!data.available?.quickbooks);
      setQbo(data.connections.find((c) => c.kind === "quickbooks") ?? null);
    } catch {
      // Offline: the card waits for the next load.
    }
  }, []);
  useEffect(() => {
    // Back from Intuit's page: say how it went.
    const r = new URLSearchParams(window.location.search).get("quickbooks");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (r && RESULT[r]) setNote(RESULT[r]);
    void refresh();
  }, [refresh]);

  async function connect() {
    setBusy("connect");
    const res = await fetch("/api/integrations/quickbooks", { method: "POST", headers: await authHeader() }).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { url?: string }) : null;
    if (body?.url) window.location.assign(body.url);
    else {
      setNote(res?.status === 401 ? "Only the owner can connect the books." : "Couldn't start. Check your connection and try again.");
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    const res = await fetch("/api/integrations/quickbooks", { method: "PUT", headers: await authHeader() }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { invoices?: number; payments?: number; costs?: number; reason?: string }) : {};
    setNote(res?.ok ? `Done: ${body.invoices ?? 0} invoices, ${body.payments ?? 0} payments, ${body.costs ?? 0} costs put in.` : (body.reason ?? "Couldn't reach QuickBooks. Try again in a minute."));
    setBusy(null);
    void refresh();
  }

  async function disconnect() {
    setBusy("off");
    await fetch("/api/integrations/quickbooks", { method: "DELETE", headers: await authHeader() }).catch(() => null);
    setNote("Disconnected. Nothing more goes into QuickBooks; what's there stays.");
    setBusy(null);
    void refresh();
  }

  if (available === false && !qbo) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>QuickBooks Online</CardTitle>
        <CardDescription>Invoices, broker payments, fuel, tolls and what drivers paid at docks go into your books on their own, every hour. Nothing to type or import.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3">
        {qbo ? (
          <>
            <p className="text-sm text-ink-800">
              {qbo.status ?? `Connected${qbo.name ? ` to ${qbo.name}` : ""}`}
              {qbo.lastSync ? <span className="text-ink-500"> · checked {new Date(qbo.lastSync).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void syncNow()}>
                {busy === "sync" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Put in what&apos;s new now
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button size="sm" disabled={!!busy || available === null} onClick={() => void connect()}>
              {busy === "connect" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Connect QuickBooks
            </Button>
          </div>
        )}
        {note && <p className="text-xs text-ink-600">{note}</p>}
      </CardContent>
    </Card>
  );
}
