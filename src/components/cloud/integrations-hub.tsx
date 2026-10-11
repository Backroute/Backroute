"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Download, ExternalLink, Loader2, Plug, RefreshCw, Search, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { askConfirm } from "@/components/ui/ask-host";
import { TimeAgo } from "@/components/shared/time-ago";
import { authHeader } from "@/lib/ai/client";
import { uploadFile } from "@/lib/cloud/files";
import { HUB, HUB_CATEGORIES, type HubEntry } from "@/lib/integrations";
import { useStore } from "@/lib/store";
import { useCarrierDrivers } from "@/lib/selectors";
import { formatCurrency } from "@/lib/utils";
import { ChannelsCard } from "./channels-card";
import { QuickbooksCard } from "./quickbooks-card";
import { ExportsCard } from "./exports-card";
import { PortalCard } from "./portal-card";

interface Connection {
  kind: string;
  status: string | null;
  checkedAt: string | null;
  name?: string | null;
  host?: string;
  postTrucks?: boolean;
  lastSync?: string | null;
}
interface Available {
  truckstop?: boolean;
  dat?: boolean;
  quickbooks?: boolean;
  xero?: boolean;
  vault?: boolean;
}

type Tone = "on" | "error" | "saved" | "off" | "builtin" | "asked";
interface EntryState {
  tone: Tone;
  text: string;
  /** The saved connection's kind, for Check now and Disconnect. */
  kind?: string;
  at?: string | null;
}

const ASKED_KEY = "backroute.integrations.asked";
const input = "min-w-0 rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400";
const CHECKABLE = /^(samsara|motive|geotab|load_feed|fuel_feed|toll_feed|truckstop|dat|board:.+)$/;
const REMOVABLE = /^(samsara|motive|geotab|load_feed|fuel_feed|toll_feed|truckstop|dat|payouts|board:.+)$/;

const initials = (name: string) =>
  name
    .replace(/\(.*\)/, "")
    .split(/[\s.&,-]+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

const NAMED_STATEMENTS = (kind: "fuel_feed" | "toll_feed") => HUB.filter((e) => e.flow.type === "statement" && e.flow.kind === kind && !e.id.startsWith("other-")).map((e) => e.name.toLowerCase());
const NAMED_FACTORS = HUB.filter((e) => e.flow.type === "factoring" && e.id !== "other-factor").map((e) => e.name);

/**
 * Settings → Integrations: everything a carrier connects, each with the whole flow in one panel: what it does, how it
 * connects, the steps, the form, a check that it works, when it last ran, and Disconnect. The practice account goes
 * through the same panels and marks what it "connects" as a sample; nothing leaves it.
 */
export function IntegrationsHub() {
  const demo = useStore((s) => s.session.mode === "demo");
  const settings = useStore((s) => s.settings);
  const router = useRouter();
  const params = useSearchParams();
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [available, setAvailable] = useState<Available>({});
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sample, setSample] = useState<Record<string, string>>({});
  const [asked, setAsked] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (demo) return;
    try {
      const res = await fetch("/api/integrations", { headers: await authHeader() });
      if (!res.ok) return;
      const data = (await res.json()) as { connections: Connection[]; available?: Available };
      setConns(data.connections);
      setAvailable(data.available ?? {});
    } catch {
      // Offline: the list shows what it had.
    }
  }, [demo]);

  useEffect(() => {
    // What's connected, once the tab opens; which "ask us" requests this device sent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    try {
      setAsked(JSON.parse(localStorage.getItem(ASKED_KEY) ?? "[]") as string[]);
    } catch {
      // Private window: nothing remembered.
    }
  }, [refresh]);

  // A link can open one panel (?open=xero), e.g. coming back from Xero or QuickBooks.
  const linked = params.get("open");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (linked && HUB.some((e) => e.id === linked)) setOpenId(linked);
  }, [linked]);

  const close = () => {
    setOpenId(null);
    if (linked) router.replace("/carrier/settings?tab=integrations", { scroll: false });
  };

  const stateOf = useCallback(
    (e: HubEntry): EntryState => {
      if (demo && sample[e.id]) return { tone: "on", text: sample[e.id] };
      const find = (kind: string) => conns?.find((c) => c.kind === kind);
      const from = (c: Connection | undefined): EntryState | null =>
        c
          ? {
              tone: c.status?.startsWith("Not working") ? "error" : c.status?.startsWith("Saved") ? "saved" : "on",
              text: c.status ?? `Connected${c.name ? ` · ${c.name}` : ""}`,
              kind: c.kind,
              at: c.lastSync ?? c.checkedAt,
            }
          : null;
      const off: EntryState = asked.includes(e.id) ? { tone: "asked", text: "Asked Backroute's support team" } : { tone: "off", text: "Not connected" };
      const f = e.flow;
      switch (f.type) {
        case "eld_key":
          return from(find(f.kind)) ?? off;
        case "geotab":
        case "quickbooks":
        case "xero":
        case "dat":
        case "truckstop":
        case "load_feed":
        case "payouts": {
          const kind = f.type === "load_feed" ? "load_feed" : f.type;
          return from(find(kind)) ?? off;
        }
        case "email":
          if (e.id === "forwarding") return { tone: "builtin", text: "Your Backroute address is ready" };
          return from(find(e.id)) ?? off;
        case "custom_board":
          return from(conns?.find((c) => c.kind.startsWith("board:"))) ?? off;
        case "statement": {
          const c = find(f.kind);
          if (!c) return off;
          const name = (c.name ?? "").toLowerCase();
          const mine = e.id.startsWith("other-") ? !NAMED_STATEMENTS(f.kind).includes(name) : name === e.name.toLowerCase();
          return mine ? (from(c) as EntryState) : off;
        }
        case "factoring": {
          if (!settings.factoringEmail) return off;
          const company = settings.factoringCompany ?? "";
          const mine = e.id === "other-factor" ? !NAMED_FACTORS.includes(company) : company === e.name;
          return mine ? { tone: "on", text: `Invoices go to ${settings.factoringEmail}` } : off;
        }
        case "portals": {
          const n = settings.setupProfiles?.length ?? 0;
          return n ? { tone: "on", text: `${n} profile${n === 1 ? "" : "s"} on setup packets` } : off;
        }
        case "exports":
          return { tone: "builtin", text: "Ready to download" };
        case "phone":
        case "builtin":
          return { tone: "builtin", text: "Built in" };
        case "request":
          return off;
      }
    },
    [asked, conns, demo, sample, settings.factoringCompany, settings.factoringEmail, settings.setupProfiles],
  );

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => HUB.filter((e) => !q || `${e.name} ${e.category} ${e.does} ${e.keywords ?? ""}`.toLowerCase().includes(q)), [q]);
  const states = useMemo(() => Object.fromEntries(HUB.map((e) => [e.id, stateOf(e)])), [stateOf]);
  const connected = HUB.filter((e) => states[e.id].tone === "on" || states[e.id].tone === "saved").length;
  const broken = HUB.filter((e) => states[e.id].tone === "error");
  const entry = openId ? HUB.find((e) => e.id === openId) : undefined;

  function markAsked(id: string) {
    const next = [...new Set([...asked, id])];
    setAsked(next);
    try {
      localStorage.setItem(ASKED_KEY, JSON.stringify(next));
    } catch {
      // Not remembered on this device.
    }
  }

  return (
    <Card id="set-integrations" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          {demo
            ? "Sample account: connecting here only shows how it works."
            : conns === null
              ? "Checking what's connected…"
              : `${connected} connected${broken.length ? ` · ${broken.length} not working: ${broken.map((b) => b.name).join(", ")}` : ""}. Tap any one to connect it, check it, or disconnect it.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-5">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            aria-label="Search integrations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Samsara, DAT, WEX, QuickBooks, factoring…"
            className="w-full rounded-full border border-line bg-ink-50/60 py-2 pl-9 pr-4 text-sm outline-none focus:border-ink-400"
          />
        </div>

        {HUB_CATEGORIES.map((cat) => {
          const items = shown.filter((e) => e.category === cat.name);
          if (!items.length) return null;
          return (
            <section key={cat.name} aria-label={cat.name}>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{cat.name}</p>
              <p className="mb-2 text-xs text-ink-500">{cat.why}</p>
              <div className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                {items.map((e) => {
                  const st = states[e.id];
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setOpenId(e.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink-50/70"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-xs font-bold text-ink-700">{initials(e.name)}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink-900">{e.name}</span>
                          <span className="block truncate text-xs text-ink-500">{st.tone === "off" ? e.does : st.text}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <StateBadge tone={st.tone} demo={demo && !!sample[e.id]} />
                        <ChevronRight className="h-4 w-4 text-ink-300" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!shown.length && <p className="text-sm text-ink-500">Nothing by that name. Try &ldquo;Another ELD&rdquo; or &ldquo;Another board&rdquo;, or ask us under any of them.</p>}
      </CardContent>

      <Sheet open={!!entry} onClose={close} title={entry?.name ?? ""} description={entry?.does} size="lg">
        {entry && (
          <Panel
            key={entry.id}
            entry={entry}
            state={states[entry.id]}
            available={available}
            demo={demo}
            onSample={(text) => setSample((s) => (text ? { ...s, [entry.id]: text } : Object.fromEntries(Object.entries(s).filter(([k]) => k !== entry.id))))}
            onChanged={refresh}
            onAsked={() => markAsked(entry.id)}
          />
        )}
      </Sheet>
    </Card>
  );
}

function StateBadge({ tone, demo }: { tone: Tone; demo?: boolean }) {
  if (demo) return <Badge tone="neutral">Sample</Badge>;
  if (tone === "on") return <Badge tone="success">Connected</Badge>;
  if (tone === "error") return <Badge tone="danger">Not working</Badge>;
  if (tone === "saved") return <Badge tone="warning">Saved</Badge>;
  if (tone === "asked") return <Badge tone="info">Asked</Badge>;
  if (tone === "builtin") return <Badge tone="neutral">Built in</Badge>;
  return null;
}

interface PanelProps {
  entry: HubEntry;
  state: EntryState;
  available: Available;
  demo: boolean;
  onSample: (text: string | null) => void;
  onChanged: () => Promise<void> | void;
  onAsked: () => void;
}

/** One integration, start to finish. */
function Panel(props: PanelProps) {
  const { entry, state, demo, onSample, onChanged } = props;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** Saves a connection: tried right away by the server, kept only if it works. */
  async function connect(body: Record<string, unknown>) {
    setMsg(null);
    if (demo) {
      onSample("Connected · sample, nothing was sent");
      setMsg({ ok: true, text: "In your own account, Backroute tries it right away and shows what it found here." });
      return true;
    }
    setBusy("connect");
    try {
      const res = await fetch("/api/integrations", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; reason?: string };
      setMsg(data.ok ? { ok: true, text: data.status ?? "Connected" } : { ok: false, text: data.reason ?? (res.status === 401 ? "Only the owner or a dispatcher can connect this." : "Couldn't connect.") });
      await onChanged();
      return !!data.ok;
    } catch {
      setMsg({ ok: false, text: "Offline. Try again." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    if (!state.kind) return;
    setBusy("check");
    setMsg(null);
    try {
      const res = await fetch(`/api/integrations?kind=${encodeURIComponent(state.kind)}`, { method: "PATCH", headers: await authHeader() });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; reason?: string };
      setMsg(data.ok ? { ok: true, text: data.status ?? "Working." } : { ok: false, text: data.reason ?? "Couldn't check it." });
    } catch {
      setMsg({ ok: false, text: "Offline. Try again." });
    }
    await onChanged();
    setBusy(null);
  }

  async function disconnect() {
    if (demo) {
      onSample(null);
      setMsg(null);
      return;
    }
    if (!state.kind) return;
    const sure = await askConfirm(`Disconnect ${entry.name}?`, "Backroute stops using it right away. What it already brought in stays.", "Disconnect", true);
    if (!sure) return;
    setBusy("off");
    await fetch(`/api/integrations?kind=${encodeURIComponent(state.kind)}`, { method: "DELETE", headers: await authHeader() }).catch(() => null);
    setMsg({ ok: true, text: "Disconnected." });
    await onChanged();
    setBusy(null);
  }

  const f = entry.flow;
  const savedConnection = state.tone === "on" || state.tone === "saved" || state.tone === "error";
  const managedHere = !!state.kind && REMOVABLE.test(state.kind);

  return (
    <div className="flex flex-col gap-5 pb-2">
      {/* Where it stands. */}
      <div className="rounded-2xl border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900">{state.text}</p>
            {state.at && (
              <p className="text-xs text-ink-500">
                Last checked <TimeAgo iso={state.at} />
              </p>
            )}
          </div>
          <StateBadge tone={state.tone} demo={demo && savedConnection} />
        </div>
        {(savedConnection && (managedHere || demo)) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {!demo && state.kind && CHECKABLE.test(state.kind) && (
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void check()}>
                {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check now
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        )}
        {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-ink-700" : "text-[var(--accent-danger)]"}`}>{msg.text}</p>}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">What Backroute does with it</p>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-800">
          {entry.gets.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">How it connects · {entry.how}</p>
        <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-800">
          {entry.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        {f.type === "eld_key" && <EldKeyForm kind={f.kind} busy={busy === "connect"} replacing={savedConnection} onSubmit={(apiKey) => connect({ kind: f.kind, apiKey })} />}
        {f.type === "geotab" && <GeotabForm busy={busy === "connect"} onSubmit={(b) => connect({ kind: "geotab", ...b })} />}
        {f.type === "dat" && (
          <BoardLoginForm
            label="DAT login email"
            placeholder="The email you sign in to DAT with"
            type="email"
            ready={props.available.dat}
            board="DAT"
            busy={busy === "connect"}
            onSubmit={(v, postTrucks) => connect({ kind: "dat", userEmail: v, postTrucks })}
          />
        )}
        {f.type === "truckstop" && (
          <BoardLoginForm
            label="Truckstop Integration ID"
            placeholder="Your Truckstop Integration ID"
            ready={props.available.truckstop}
            board="Truckstop"
            busy={busy === "connect"}
            onSubmit={(v, postTrucks) => connect({ kind: "truckstop", integrationId: v, postTrucks })}
          />
        )}
        {f.type === "custom_board" && <CustomBoardForm busy={busy === "connect"} onSubmit={(config) => connect({ kind: "board", config })} onBad={(t) => setMsg({ ok: false, text: t })} />}
        {f.type === "load_feed" && <FeedForm busy={busy === "connect"} onSubmit={(b) => connect({ kind: "load_feed", ...b })} />}
        {f.type === "statement" && <StatementForm kind={f.kind} name={entry.id.startsWith("other-") ? "" : entry.name} busy={busy === "connect"} onSubmit={(b) => connect({ kind: f.kind, ...b })} />}
        {f.type === "factoring" && <FactoringForm entry={entry} demo={demo} />}
        {f.type === "payouts" && <PayoutsForm demo={demo} vault={props.available.vault !== false} onChanged={onChanged} />}
        {f.type === "quickbooks" &&
          (demo ? (
            <SampleNote what="QuickBooks" />
          ) : props.available.quickbooks === false && !savedConnection ? (
            <p className="text-sm text-ink-600">QuickBooks isn&apos;t switched on for Backroute yet. Use Spreadsheet exports meanwhile.</p>
          ) : (
            <QuickbooksCard />
          ))}
        {f.type === "xero" && (demo ? <SampleNote what="Xero" /> : <XeroForm connected={savedConnection} ready={props.available.xero} onChanged={onChanged} />)}
        {(f.type === "email" || f.type === "phone") && (demo ? <SampleNote what={entry.name} /> : <ChannelsCard />)}
        {f.type === "exports" && (demo ? <SampleNote what="Downloads" /> : <ExportsCard />)}
        {f.type === "portals" && (demo ? <SampleNote what="Setup profiles and broker logins" /> : (
          <>
            <p className="text-sm text-ink-700">
              Profile links go on every setup packet. Add them under{" "}
              <Link className="font-medium underline" href="/carrier/settings?tab=general#set-business">
                Company → Rates, billing and check-ins
              </Link>
              .
            </p>
            <PortalCard />
          </>
        ))}
        {f.type === "builtin" &&
          (f.href ? (
            <Link href={f.href} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-medium text-white">
              {f.hrefLabel ?? "Open"} <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <p className="text-sm text-ink-600">Nothing to connect here.</p>
          ))}
        {(f.type === "request" || f.type === "eld_key" || f.type === "geotab" || f.type === "factoring" || f.type === "statement") && (
          <RequestForm entry={entry} demo={demo} asked={state.tone === "asked"} onAsked={props.onAsked} primary={f.type === "request"} />
        )}
      </div>
    </div>
  );
}

function SampleNote({ what }: { what: string }) {
  return <p className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600">{what} connects in your own account. This sample account doesn&apos;t send anything anywhere.</p>;
}

function ConnectButton({ busy, disabled, onClick, label = "Connect" }: { busy: boolean; disabled?: boolean; onClick: () => void; label?: string }) {
  return (
    <Button size="sm" disabled={busy || disabled} onClick={onClick}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} {label}
    </Button>
  );
}

function EldKeyForm({ kind, busy, replacing, onSubmit }: { kind: "samsara" | "motive"; busy: boolean; replacing: boolean; onSubmit: (key: string) => Promise<boolean> }) {
  const [key, setKey] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <input
        aria-label={`${kind === "samsara" ? "Samsara" : "Motive"} API key`}
        className={input}
        type="password"
        autoComplete="off"
        placeholder={kind === "samsara" ? "API token" : "API key"}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <div>
        <ConnectButton busy={busy} disabled={key.trim().length < 8} label={replacing ? "Replace the key" : "Connect"} onClick={() => void onSubmit(key.trim()).then((ok) => ok && setKey(""))} />
      </div>
      <p className="text-xs text-ink-500">Trucks match by unit number and drivers by name, so keep them the same as in the ELD. The key is kept on the server and never shown again.</p>
    </div>
  );
}

function GeotabForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: { database: string; userName: string; password: string }) => Promise<boolean> }) {
  const [f, setF] = useState({ database: "", userName: "", password: "" });
  return (
    <div className="flex flex-col gap-2">
      <input aria-label="MyGeotab database" className={input} placeholder="Database (the name in your MyGeotab address)" value={f.database} onChange={(e) => setF({ ...f, database: e.target.value })} />
      <input aria-label="MyGeotab user" className={input} placeholder="User (email)" autoComplete="off" value={f.userName} onChange={(e) => setF({ ...f, userName: e.target.value })} />
      <input aria-label="MyGeotab password" className={input} type="password" autoComplete="new-password" placeholder="Password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <div>
        <ConnectButton busy={busy} disabled={f.database.trim().length < 2 || f.userName.trim().length < 2 || f.password.length < 4} onClick={() => void onSubmit(f).then((ok) => ok && setF({ ...f, password: "" }))} />
      </div>
    </div>
  );
}

function BoardLoginForm(p: { label: string; placeholder: string; type?: string; ready?: boolean; board: string; busy: boolean; onSubmit: (v: string, postTrucks: boolean) => Promise<boolean> }) {
  const [v, setV] = useState("");
  const [post, setPost] = useState(true);
  return (
    <div className="flex flex-col gap-2">
      <input aria-label={p.label} className={input} type={p.type ?? "text"} placeholder={p.placeholder} value={v} onChange={(e) => setV(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} /> Post my empty trucks on {p.board}
      </label>
      <div>
        <ConnectButton busy={p.busy} disabled={!v.trim()} onClick={() => void p.onSubmit(v.trim(), post)} />
      </div>
      {p.ready === false && <p className="text-xs text-ink-500">Backroute&apos;s {p.board} agreement isn&apos;t in place yet: your login is saved now, and searching starts when it is.</p>}
    </div>
  );
}

const CUSTOM_EXAMPLE = `{
  "name": "My board",
  "searchUrl": "https://…/loads?origin={{originCity}},{{originState}}&radius={{radius}}&date={{date}}",
  "method": "GET",
  "headers": { "Authorization": "Bearer …" },
  "listPath": "loads",
  "fields": { "loadNumber": "id", "originCity": "origin.city", "originState": "origin.state",
    "destinationCity": "destination.city", "destinationState": "destination.state",
    "pickupLocal": "pickupDate", "rate": "rate", "miles": "miles", "brokerName": "poster.name" }
}`;

function CustomBoardForm({ busy, onSubmit, onBad }: { busy: boolean; onSubmit: (config: unknown) => Promise<boolean>; onBad: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <textarea aria-label="Load board setup" className={`${input} h-44 font-mono text-xs`} placeholder={CUSTOM_EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} />
      <div>
        <ConnectButton
          busy={busy}
          disabled={!text.trim()}
          label="Test and add"
          onClick={() => {
            try {
              void onSubmit(JSON.parse(text));
            } catch {
              onBad("That isn't valid JSON.");
            }
          }}
        />
      </div>
    </div>
  );
}

function FeedForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [f, setF] = useState({ url: "", format: "json" as "json" | "csv", name: "", headerName: "", headerValue: "" });
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
      <input aria-label="Feed address" className={input} placeholder="https://… (JSON or CSV)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      <select aria-label="Feed format" className={input} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as "json" | "csv" })}>
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
      </select>
      <input aria-label="Feed name" className={`${input} sm:col-span-2`} placeholder="Name (e.g. Acme Logistics loads)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input aria-label="Feed header name" className={input} placeholder="Header, if it needs one" value={f.headerName} onChange={(e) => setF({ ...f, headerName: e.target.value })} />
      <input aria-label="Feed header value" className={input} type="password" placeholder="Value" value={f.headerValue} onChange={(e) => setF({ ...f, headerValue: e.target.value })} />
      <div className="sm:col-span-2">
        <ConnectButton busy={busy} disabled={!f.url.trim()} label="Test and add" onClick={() => void onSubmit(f)} />
      </div>
    </div>
  );
}

function StatementForm({ kind, name, busy, onSubmit }: { kind: "fuel_feed" | "toll_feed"; name: string; busy: boolean; onSubmit: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [f, setF] = useState({ url: "", name, headerName: "", headerValue: "" });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink-900">Read a report address every round</p>
      <input aria-label="Statement address" className={input} placeholder="https://… (the CSV report's link)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      {!name && <input aria-label="Statement name" className={input} placeholder={kind === "fuel_feed" ? "Card name" : "Toll account name"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
      <div className="grid grid-cols-2 gap-2">
        <input aria-label="Statement header name" className={input} placeholder="Header (optional)" value={f.headerName} onChange={(e) => setF({ ...f, headerName: e.target.value })} />
        <input aria-label="Statement header value" className={input} type="password" placeholder="Value" value={f.headerValue} onChange={(e) => setF({ ...f, headerValue: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ConnectButton busy={busy} disabled={!f.url.trim()} label="Test and connect" onClick={() => void onSubmit(f)} />
        <Link href="/carrier/costs" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-medium text-ink-800">
          <Upload className="h-3.5 w-3.5" /> Upload a file instead
        </Link>
      </div>
      <p className="text-xs text-ink-500">One {kind === "fuel_feed" ? "fuel card" : "toll"} report address at a time; files from other cards can always be uploaded on Costs.</p>
    </div>
  );
}

function FactoringForm({ entry, demo }: { entry: HubEntry; demo: boolean }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const other = entry.id === "other-factor";
  const mine = settings.factoringEmail && (other ? !NAMED_FACTORS.includes(settings.factoringCompany ?? "") : settings.factoringCompany === entry.name);
  const [company, setCompany] = useState(other ? (mine ? (settings.factoringCompany ?? "") : "") : entry.name);
  const [email, setEmail] = useState(mine ? (settings.factoringEmail ?? "") : "");
  const [note, setNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && company.trim().length > 1;

  async function noa(file: File) {
    if (demo) return setNote("Sample account: the NOA isn't kept.");
    setUploading(true);
    const r = await uploadFile("noa", file);
    setUploading(false);
    setNote(r.ok ? "Notice of Assignment saved. It goes with setup packets from now on." : (r.reason || "Couldn't upload it. Try again."));
  }

  return (
    <div className="flex flex-col gap-2">
      {other && <input aria-label="Factoring company" className={input} placeholder="Factoring company name" value={company} onChange={(e) => setCompany(e.target.value)} />}
      <input aria-label="Invoice submission email" className={input} type="email" placeholder="The submission email from your agreement" value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => {
            updateSettings({ factoringEmail: email.trim(), factoringCompany: company.trim() });
            setNote(`Saved. Invoices go to ${email.trim()} from the next one.`);
          }}
        >
          <Plug className="h-3.5 w-3.5" /> Save
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-medium text-ink-800">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload the NOA
          <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void noa(e.target.files[0])} />
        </label>
        {mine && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!(await askConfirm("Stop sending invoices to the factor?", "New invoices go to the broker again. Invoices already sent stay with the factor.", "Stop", true))) return;
              updateSettings({ factoringEmail: undefined, factoringCompany: undefined });
              setEmail("");
              setNote("Stopped. New invoices go to brokers.");
            }}
          >
            Stop factoring
          </Button>
        )}
      </div>
      {note && <p className="text-xs text-ink-600">{note}</p>}
    </div>
  );
}

const XERO_RESULT: Record<string, string> = {
  connected: "Xero is connected. The first invoices go in within the hour.",
  cancelled: "Not connected: Xero was closed before it finished.",
  expired: "That took too long. Start again.",
  failed: "Xero didn't let us in. Try again.",
  off: "Xero isn't available yet.",
};

function XeroForm({ connected, ready, onChanged }: { connected: boolean; ready?: boolean; onChanged: () => Promise<void> | void }) {
  const result = useSearchParams().get("xero");
  const [codes, setCodes] = useState({ sales: "200", bank: "090" });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(result ? (XERO_RESULT[result] ?? null) : null);

  async function start() {
    setBusy("connect");
    const res = await fetch("/api/integrations/xero", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(codes) }).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { url?: string }) : null;
    if (body?.url) return window.location.assign(body.url);
    setNote(res?.status === 401 ? "Only the owner can connect the books." : res?.status === 400 ? "Account codes are short codes like 200." : "Couldn't start. Try again.");
    setBusy(null);
  }
  async function sync() {
    setBusy("sync");
    const res = await fetch("/api/integrations/xero", { method: "PUT", headers: await authHeader() }).catch(() => null);
    const b = res ? ((await res.json().catch(() => ({}))) as { invoices?: number; payments?: number; reason?: string }) : {};
    setNote(res?.ok ? `Done: ${b.invoices ?? 0} invoices and ${b.payments ?? 0} payments put in.` : (b.reason ?? "Couldn't reach Xero. Try again in a minute."));
    setBusy(null);
    await onChanged();
  }
  async function off() {
    if (!(await askConfirm("Disconnect Xero?", "Nothing more goes into Xero; what's there stays.", "Disconnect", true))) return;
    setBusy("off");
    await fetch("/api/integrations/xero", { method: "DELETE", headers: await authHeader() }).catch(() => null);
    setNote("Disconnected.");
    setBusy(null);
    await onChanged();
  }

  if (ready === false && !connected) return <p className="text-sm text-ink-600">Xero isn&apos;t switched on for Backroute yet. Ask us below and we&apos;ll tell you when it is.</p>;
  return (
    <div className="flex flex-col gap-2">
      {connected ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void sync()}>
            {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Put in what&apos;s new now
          </Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void off()}>
            Disconnect
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-600">
              Sales account code
              <input aria-label="Sales account code" className={input} value={codes.sales} onChange={(e) => setCodes({ ...codes, sales: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-600">
              Bank account code
              <input aria-label="Bank account code" className={input} value={codes.bank} onChange={(e) => setCodes({ ...codes, bank: e.target.value })} />
            </label>
          </div>
          <div>
            <ConnectButton busy={busy === "connect"} disabled={!codes.sales.trim() || !codes.bank.trim()} label="Connect Xero" onClick={() => void start()} />
          </div>
        </>
      )}
      {note && <p className="text-xs text-ink-600">{note}</p>}
    </div>
  );
}

interface PayoutsInfo {
  company: { name: string; companyId: string; bankRouting: string; bankName: string; immediateOrigin?: string } | null;
  drivers: Record<string, { routing: string; last4: string; type: "checking" | "savings"; at: string }>;
}

function PayoutsForm({ demo, vault, onChanged }: { demo: boolean; vault: boolean; onChanged: () => Promise<void> | void }) {
  const drivers = useCarrierDrivers();
  const payRuns = useStore((s) => s.payRuns);
  const [info, setInfo] = useState<PayoutsInfo | null>(null);
  const [company, setCompany] = useState({ name: "", companyId: "", bankRouting: "", bankName: "", immediateOrigin: "" });
  const [bank, setBank] = useState<{ driverId: string; routing: string; account: string; type: "checking" | "savings" } | null>(null);
  const [week, setWeek] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const weeks = useMemo(() => [...new Set(payRuns.map((r) => r.period))].sort().reverse().slice(0, 8), [payRuns]);

  const load = useCallback(async () => {
    if (demo) return;
    const res = await fetch("/api/integrations/payouts", { headers: await authHeader() }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as PayoutsInfo;
    setInfo(data);
    if (data.company) setCompany({ ...data.company, immediateOrigin: data.company.immediateOrigin ?? "" });
  }, [demo]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function post(body: unknown, done: string) {
    if (demo) return setNote({ ok: true, text: "Sample account: nothing was saved." });
    setBusy("save");
    const res = await fetch("/api/integrations/payouts", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) }).catch(() => null);
    const b = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string }) : {};
    setNote(b.ok ? { ok: true, text: done } : { ok: false, text: b.reason ?? (res?.status === 401 ? "Only the owner can set up driver pay." : "Couldn't save it.") });
    setBusy(null);
    if (b.ok) {
      setBank(null);
      await load();
      await onChanged();
    }
  }

  async function removeBank(driverId: string, name: string) {
    if (!(await askConfirm(`Remove ${name}'s bank account?`, "They won't be in the bank file until it's added again.", "Remove", true))) return;
    await fetch(`/api/integrations/payouts?driverId=${encodeURIComponent(driverId)}`, { method: "DELETE", headers: await authHeader() }).catch(() => null);
    await load();
  }

  async function download() {
    if (!week) return;
    setBusy("file");
    setNote(null);
    const res = await fetch(`/api/integrations/payouts?file=${week}`, { headers: await authHeader() }).catch(() => null);
    const b = res ? ((await res.json().catch(() => ({}))) as { file?: string; total?: number; paid?: string[]; skipped?: string[]; reason?: string }) : {};
    if (b.file) {
      const url = URL.createObjectURL(new Blob([b.file], { type: "text/plain" }));
      Object.assign(document.createElement("a"), { href: url, download: `driver-pay-${week}.ach` }).click();
      URL.revokeObjectURL(url);
      setNote({ ok: true, text: `Bank file for ${b.paid?.length ?? 0} driver${b.paid?.length === 1 ? "" : "s"}, ${formatCurrency(b.total ?? 0)}.${b.skipped?.length ? ` Not in it (no account on file): ${b.skipped.join(", ")}.` : ""} Upload it on your bank's ACH page.` });
    } else setNote({ ok: false, text: b.reason ?? "Couldn't build the file." });
    setBusy(null);
  }

  if (!demo && !vault) return <p className="text-sm text-ink-600">Direct deposit needs Backroute&apos;s encryption key set up first (see the deploy guide).</p>;
  const routingOk = (r: string) => /^\d{9}$/.test(r);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink-900">1. The bank the pay comes from</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input aria-label="Company name at the bank" className={input} placeholder="Company name as the bank has it" value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
          <input aria-label="ACH company ID" className={input} placeholder="ACH company ID (from the bank)" value={company.companyId} onChange={(e) => setCompany({ ...company, companyId: e.target.value })} />
          <input aria-label="Bank name" className={input} placeholder="Bank name" value={company.bankName} onChange={(e) => setCompany({ ...company, bankName: e.target.value })} />
          <input aria-label="Bank routing number" className={input} inputMode="numeric" placeholder="Bank routing number (9 digits)" value={company.bankRouting} onChange={(e) => setCompany({ ...company, bankRouting: e.target.value.replace(/\D/g, "").slice(0, 9) })} />
          <input aria-label="Immediate origin" className={`${input} sm:col-span-2`} placeholder="Immediate origin, only if your bank gives one" value={company.immediateOrigin} onChange={(e) => setCompany({ ...company, immediateOrigin: e.target.value })} />
        </div>
        <div>
          <Button
            size="sm"
            disabled={busy === "save" || company.name.trim().length < 2 || company.companyId.trim().length < 5 || company.bankName.trim().length < 2 || !routingOk(company.bankRouting)}
            onClick={() => void post({ company: { ...company, immediateOrigin: company.immediateOrigin.trim() || undefined } }, "Saved the sending bank.")}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink-900">2. Each driver&apos;s account</p>
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {drivers.map((d) => {
            const on = info?.drivers[d.id];
            return (
              <div key={d.id} className="flex flex-col gap-2 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{d.name}</p>
                    <p className="text-xs text-ink-500">{on ? `${on.type === "savings" ? "Savings" : "Checking"} ${on.last4}` : "No account on file"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" onClick={() => setBank({ driverId: d.id, routing: on?.routing ?? "", account: "", type: on?.type ?? "checking" })}>
                      {on ? "Change" : "Add"}
                    </Button>
                    {on && (
                      <Button size="sm" variant="ghost" onClick={() => void removeBank(d.id, d.name)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                {bank?.driverId === d.id && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem]">
                    <input aria-label={`${d.name} routing number`} className={input} inputMode="numeric" placeholder="Routing (9 digits)" value={bank.routing} onChange={(e) => setBank({ ...bank, routing: e.target.value.replace(/\D/g, "").slice(0, 9) })} />
                    <input aria-label={`${d.name} account number`} className={input} inputMode="numeric" autoComplete="off" placeholder="Account number" value={bank.account} onChange={(e) => setBank({ ...bank, account: e.target.value.replace(/[^\d ]/g, "") })} />
                    <select aria-label={`${d.name} account type`} className={input} value={bank.type} onChange={(e) => setBank({ ...bank, type: e.target.value as "checking" | "savings" })}>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                    <div className="flex gap-2 sm:col-span-3">
                      <Button size="sm" disabled={busy === "save" || !routingOk(bank.routing) || bank.account.replace(/\s/g, "").length < 4} onClick={() => void post(bank, `Saved ${d.name}'s account.`)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setBank(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!drivers.length && <p className="px-3 py-2.5 text-sm text-ink-500">Add drivers on Fleet first.</p>}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink-900">3. Each week&apos;s bank file</p>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Pay week" className={input} value={week} onChange={(e) => setWeek(e.target.value)}>
            <option value="">{weeks.length ? "Pick a week" : "No pay runs yet"}</option>
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week of {new Date(`${w}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={!week || busy === "file" || demo} onClick={() => void download()}>
            {busy === "file" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download bank file
          </Button>
        </div>
        <p className="text-xs text-ink-500">Pay runs are on Money → Costs &amp; drivers. Check the file layout with your bank before the first upload.</p>
      </div>
      {note && <p className={`text-xs ${note.ok ? "text-ink-700" : "text-[var(--accent-danger)]"}`}>{note.text}</p>}
    </div>
  );
}

function RequestForm({ entry, demo, asked, onAsked, primary }: { entry: HubEntry; demo: boolean; asked: boolean; onAsked: () => void; primary: boolean }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(primary);

  async function send() {
    if (demo) {
      setDone("Sample account: nothing was sent.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/integrations/request", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ name: entry.name, note: note.trim() || undefined }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onAsked();
      setDone("Sent. Backroute's support team will reach out to finish it with you.");
    } else setDone(res?.status === 429 ? "You've sent a lot of these today. Try tomorrow." : "Couldn't send it. Try again.");
  }

  if (!open)
    return (
      <button type="button" className="w-fit text-xs font-medium text-ink-500 underline" onClick={() => setOpen(true)}>
        Stuck? Ask us to connect it for you
      </button>
    );
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-ink-50 p-3">
      <p className="text-sm font-medium text-ink-900">{asked ? "You asked us about this one" : "Ask us to connect it"}</p>
      <textarea aria-label="Anything we should know" className={`${input} h-20`} placeholder="Your account ID, a contact there, anything that helps" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <div>
        <Button size="sm" variant={primary ? "primary" : "outline"} disabled={busy} onClick={() => void send()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {asked ? "Ask again" : "Ask us to connect it"}
        </Button>
      </div>
      {done && <p className="text-xs text-ink-600">{done}</p>}
    </div>
  );
}
