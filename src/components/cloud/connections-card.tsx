"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authHeader } from "@/lib/ai/client";

interface Connection {
  kind: "samsara" | "motive" | "load_feed";
  status: string | null;
  checkedAt: string | null;
  name?: string | null;
  host?: string;
}

const LABEL = { samsara: "Samsara ELD", motive: "Motive ELD", load_feed: "Load feed" };

/**
 * The outside services the AI reads from: the ELD (where trucks are, how many hours drivers have) and load feeds.
 * Keys are sent once and kept on the server; this card only ever shows whether they work.
 */
export function ConnectionsCard() {
  const [list, setList] = useState<Connection[] | null>(null);
  const [eld, setEld] = useState<"samsara" | "motive">("samsara");
  const [apiKey, setApiKey] = useState("");
  const [feed, setFeed] = useState({ url: "", format: "json" as "json" | "csv", headerName: "", headerValue: "", name: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations", { headers: await authHeader() });
      if (res.ok) setList(((await res.json()) as { connections: Connection[] }).connections);
    } catch {
      // Offline: shows nothing until the next load.
    }
  }, []);
  useEffect(() => {
    // Loading what's connected once the card opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function connect(body: Record<string, unknown>, what: string) {
    setBusy(what);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; reason?: string };
      setMsg(data.ok ? { ok: true, text: data.status ?? "Connected" } : { ok: false, text: data.reason ?? "Couldn't connect." });
      if (data.ok) {
        setApiKey("");
        await refresh();
      }
    } catch {
      setMsg({ ok: false, text: "Offline. Try again." });
    }
    setBusy(null);
  }

  async function remove(kind: Connection["kind"]) {
    setBusy(kind);
    await fetch(`/api/integrations?kind=${kind}`, { method: "DELETE", headers: await authHeader() }).catch(() => {});
    await refresh();
    setBusy(null);
  }

  const input = "min-w-0 rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400";
  return (
    <Card>
      <CardHeader>
        <CardTitle>ELD and load feeds</CardTitle>
        <CardDescription>With your ELD, the AI sees where trucks are and drivers&apos; hours: it books only what a driver can legally make, and warns brokers before a truck is late.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-5">
        {list && list.length > 0 && (
          <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {list.map((c) => (
              <div key={c.kind} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">
                    {LABEL[c.kind]}
                    {c.name ? `: ${c.name}` : ""}
                    {c.host ? ` (${c.host})` : ""}
                  </p>
                  <p className={`truncate text-xs ${c.status?.startsWith("Not working") ? "text-[var(--accent-danger)]" : "text-ink-500"}`}>{c.status ?? "Not checked yet"}</p>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Remove ${LABEL[c.kind]}`} disabled={!!busy} onClick={() => void remove(c.kind)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ink-700">Connect your ELD</p>
          <div className="flex flex-wrap gap-2">
            <select aria-label="ELD" className={input} value={eld} onChange={(e) => setEld(e.target.value as "samsara" | "motive")}>
              <option value="samsara">Samsara</option>
              <option value="motive">Motive</option>
            </select>
            <input aria-label="ELD API key" className={`${input} flex-1`} type="password" placeholder={eld === "samsara" ? "API token (Settings → API tokens)" : "API key (Admin → API keys)"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <Button size="sm" disabled={!!busy || apiKey.trim().length < 8} onClick={() => void connect({ kind: eld, apiKey }, "eld")}>
              {busy === "eld" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Connect
            </Button>
          </div>
          <p className="text-[11px] text-ink-500">Trucks are matched by unit number and drivers by name, so keep them the same as in the ELD. Read-only access is enough.</p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ink-700">Add a load feed</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
            <input aria-label="Feed address" className={input} placeholder="https://… (JSON or CSV)" value={feed.url} onChange={(e) => setFeed({ ...feed, url: e.target.value })} />
            <select aria-label="Feed format" className={input} value={feed.format} onChange={(e) => setFeed({ ...feed, format: e.target.value as "json" | "csv" })}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
            <input aria-label="Feed name" className={input} placeholder="Name (e.g. Acme Logistics loads)" value={feed.name} onChange={(e) => setFeed({ ...feed, name: e.target.value })} />
            <span />
            <input aria-label="Feed header name" className={input} placeholder="Header, if it needs one (optional)" value={feed.headerName} onChange={(e) => setFeed({ ...feed, headerName: e.target.value })} />
            <input aria-label="Feed header value" className={input} type="password" placeholder="Value" value={feed.headerValue} onChange={(e) => setFeed({ ...feed, headerValue: e.target.value })} />
          </div>
          <div>
            <Button size="sm" disabled={!!busy || !feed.url.trim()} onClick={() => void connect({ kind: "load_feed", ...feed }, "feed")}>
              {busy === "feed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Add feed
            </Button>
          </div>
          <p className="text-[11px] text-ink-500">Any list of loads a broker, shipper or load board can publish. The fields are in DEPLOY.md. DAT and Truckstop need their own API agreement first.</p>
        </div>
        {msg && <p className={`text-xs ${msg.ok ? "text-[var(--accent-live)]" : "text-[var(--accent-danger)]"}`}>{msg.text}</p>}
      </CardContent>
    </Card>
  );
}
