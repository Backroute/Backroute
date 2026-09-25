"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authHeader } from "@/lib/ai/client";

interface Connection {
  kind: string;
  status: string | null;
  checkedAt: string | null;
  name?: string | null;
  host?: string;
  postTrucks?: boolean;
}

const LABEL: Record<string, string> = { samsara: "Samsara ELD", motive: "Motive ELD", load_feed: "Load feed", truckstop: "Truckstop", dat: "DAT" };
const label = (kind: string) => LABEL[kind] ?? "Load board";

const CUSTOM_EXAMPLE = `{
  "name": "123Loadboard",
  "searchUrl": "https://…/loads?origin={{originCity}},{{originState}}&radius={{radius}}&date={{date}}&equipment={{equipmentCode}}",
  "method": "GET",
  "headers": { "Authorization": "Bearer …" },
  "listPath": "loads",
  "fields": { "loadNumber": "id", "originCity": "origin.city", "originState": "origin.state",
    "destinationCity": "destination.city", "destinationState": "destination.state", "pickupLocal": "pickupDate",
    "rate": "rate", "miles": "miles", "equipment": "equipment", "brokerName": "poster.name",
    "brokerPhone": "poster.phone", "brokerEmail": "poster.email", "brokerMc": "poster.mc" }
}`;

/**
 * The outside services the AI reads from: the ELD (where trucks are, how many hours drivers have) and load feeds.
 * Keys are sent once and kept on the server; this card only ever shows whether they work.
 */
export function ConnectionsCard() {
  const [list, setList] = useState<Connection[] | null>(null);
  const [available, setAvailable] = useState<{ truckstop: boolean; dat: boolean }>({ truckstop: false, dat: false });
  const [ts, setTs] = useState({ integrationId: "", postTrucks: true });
  const [dat, setDat] = useState({ userEmail: "", postTrucks: true });
  const [custom, setCustom] = useState("");
  const [eld, setEld] = useState<"samsara" | "motive">("samsara");
  const [apiKey, setApiKey] = useState("");
  const [feed, setFeed] = useState({ url: "", format: "json" as "json" | "csv", headerName: "", headerValue: "", name: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations", { headers: await authHeader() });
      if (res.ok) {
        const data = (await res.json()) as { connections: Connection[]; available?: { truckstop: boolean; dat: boolean } };
        setList(data.connections);
        if (data.available) setAvailable(data.available);
      }
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

  function addCustom() {
    try {
      void connect({ kind: "board", config: JSON.parse(custom) }, "custom");
    } catch {
      setMsg({ ok: false, text: "That isn't valid JSON." });
    }
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
        <CardTitle>ELD, load boards and feeds</CardTitle>
        <CardDescription>
          With your ELD, the AI sees where trucks are and drivers&apos; hours. With load boards, it searches for every truck that&apos;s empty or about to be, lines up the
          reload before delivery, and posts your trucks.
        </CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-5">
        {list && list.length > 0 && (
          <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {list.map((c) => (
              <div key={c.kind} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">
                    {label(c.kind)}
                    {c.name ? `: ${c.name}` : ""}
                    {c.host ? ` (${c.host})` : ""}
                  </p>
                  <p className={`truncate text-xs ${c.status?.startsWith("Not working") ? "text-[var(--accent-danger)]" : "text-ink-500"}`}>{c.status ?? "Not checked yet"}</p>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Remove ${label(c.kind)}`} disabled={!!busy} onClick={() => void remove(c.kind)}>
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
          <p className="text-xs font-medium text-ink-700">Load boards</p>
          <div className="grid gap-2 rounded-xl border border-line p-3">
            <p className="text-sm font-medium text-ink-900">Truckstop</p>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Truckstop Integration ID" className={`${input} flex-1`} placeholder="Your Truckstop Integration ID" value={ts.integrationId} onChange={(e) => setTs({ ...ts, integrationId: e.target.value })} />
              <label className="flex items-center gap-1.5 text-xs text-ink-600">
                <input type="checkbox" checked={ts.postTrucks} onChange={(e) => setTs({ ...ts, postTrucks: e.target.checked })} /> Post my empty trucks
              </label>
              <Button size="sm" disabled={!!busy || !ts.integrationId.trim()} onClick={() => void connect({ kind: "truckstop", ...ts }, "truckstop")}>
                {busy === "truckstop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Connect
              </Button>
            </div>
            {!available.truckstop && <p className="text-[11px] text-ink-500">Backroute&apos;s Truckstop agreement isn&apos;t in place yet: you can save your ID now, and searching starts when it is.</p>}
          </div>
          <div className="grid gap-2 rounded-xl border border-line p-3">
            <p className="text-sm font-medium text-ink-900">DAT</p>
            <div className="flex flex-wrap gap-2">
              <input aria-label="DAT login email" className={`${input} flex-1`} type="email" placeholder="The email you sign in to DAT with" value={dat.userEmail} onChange={(e) => setDat({ ...dat, userEmail: e.target.value })} />
              <label className="flex items-center gap-1.5 text-xs text-ink-600">
                <input type="checkbox" checked={dat.postTrucks} onChange={(e) => setDat({ ...dat, postTrucks: e.target.checked })} /> Post my empty trucks
              </label>
              <Button size="sm" disabled={!!busy || !dat.userEmail.trim()} onClick={() => void connect({ kind: "dat", ...dat }, "dat")}>
                {busy === "dat" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Connect
              </Button>
            </div>
            {!available.dat && <p className="text-[11px] text-ink-500">Backroute&apos;s DAT agreement isn&apos;t in place yet: you can save your DAT login now, and searching starts when it is.</p>}
          </div>
          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer text-sm font-medium text-ink-900">Another load board (123Loadboard and others)</summary>
            <p className="mt-2 text-[11px] text-ink-500">Any board with an API, described in JSON: where to search, and where each field is. Backroute support fills this in from the board&apos;s API documents.</p>
            <textarea aria-label="Load board setup" className={`${input} mt-2 h-40 w-full font-mono text-[11px]`} placeholder={CUSTOM_EXAMPLE} value={custom} onChange={(e) => setCustom(e.target.value)} />
            <Button size="sm" className="mt-2" disabled={!!busy || !custom.trim()} onClick={addCustom}>
              {busy === "custom" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Add board
            </Button>
          </details>
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
