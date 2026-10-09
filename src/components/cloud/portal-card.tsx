"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, KeyRound, Loader2, Plus, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { openFile } from "@/lib/cloud/files";
import { portalAct, portalOverview, type PortalOverview } from "@/lib/cloud/portal";
import { PORTAL_KIND_LABEL, type PortalStatus } from "@/lib/portal/types";

const STATUS: Record<PortalStatus, string> = {
  queued: "Waiting to start",
  running: "Working on it",
  needs_approval: "Waiting for your OK",
  needs_answer: "Waiting for your answer",
  needs_code: "Waiting for a code",
  done: "Done",
  failed: "Handed to support",
  cancelled: "Stopped",
};

/**
 * Broker websites: the logins the AI uses to sign rate cons, fill carrier setups and book dock appointments on other
 * companies' sites, and what it did there. Passwords go in and are never shown again, not even here.
 */
export function PortalCard() {
  const on = useStore((s) => s.settings.portalAi === true);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const [data, setData] = useState<PortalOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = useCallback(async () => {
    const r = await portalOverview();
    if (r.ok) setData(r.data);
    else setError(r.reason);
  }, []);
  useEffect(() => {
    // Loading the logins and jobs once the card opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function act(body: Record<string, unknown>) {
    setError(null);
    const r = await portalAct(body);
    if (!r.ok) setError(r.reason);
    await refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Broker websites</CardTitle>
        <CardDescription>
          Backroute signs rate cons in DocuSign and broker portals, fills carrier setups (MyCarrierPackets, RMIS, Highway) and books dock appointments online. Add the logins it should use. Passwords are encrypted and never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-4">
        {data && !data.ready ? (
          <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600">Not available on your account yet. Until it is, Backroute support does these for you.</p>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">Let Backroute do these itself</p>
              <p className="text-xs text-ink-500">It checks the rate before it signs, and asks you before it submits a carrier setup, unless you told it not to. Off: Backroute support does them.</p>
            </div>
            <Switch checked={on} onChange={(v) => updateSettings({ portalAi: v })} label="Let Backroute do these itself" />
          </div>
        )}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink-900">Logins</p>
            {!adding && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={data ? !data.ready : true}>
                <Plus className="h-3.5 w-3.5" /> Add a login
              </Button>
            )}
          </div>
          {adding && <LoginForm onDone={async () => (setAdding(false), await refresh())} onCancel={() => setAdding(false)} />}
          {data === null ? (
            <p className="text-xs text-ink-500">…</p>
          ) : data.logins.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {data.logins.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{l.label}</p>
                      <p className="truncate text-xs text-ink-500">
                        {l.site} · {l.username ?? "user on file"} · password saved{l.twoStep ? " · 2-step on" : ""}
                        {l.lastUsedAt ? ` · last used ${new Date(l.lastUsedAt).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" aria-label={`Remove the login for ${l.site}`} onClick={() => void act({ op: "forget", id: l.id })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-500">None yet. When a site needs one Backroute doesn&apos;t have, it asks you once, or opens the account itself on setup networks.</p>
          )}
        </section>

        {data?.answers.length ? (
          <section className="flex flex-col gap-2 border-t border-line pt-3">
            <p className="text-sm font-medium text-ink-900">Answers Backroute keeps for these sites</p>
            <ul className="flex flex-col divide-y divide-line">
              {data.answers.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <p className="min-w-0 truncate text-xs text-ink-600">{a.label}</p>
                  <Button size="sm" variant="ghost" aria-label="Forget this answer" onClick={() => void act({ op: "forget", id: a.id })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data?.tasks.length ? (
          <section className="flex flex-col gap-2 border-t border-line pt-3">
            <p className="text-sm font-medium text-ink-900">Recent work on websites</p>
            <ul className="flex flex-col divide-y divide-line">
              {data.tasks.slice(0, 10).map((t) => (
                <li key={t.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                      <Globe className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-900">
                        {PORTAL_KIND_LABEL[t.kind]}
                        {t.loadRef ? ` · ${t.loadRef}` : ""} · {t.site}
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {STATUS[t.status]}
                        {t.note ? ` · ${t.note}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {t.screenshotId && (
                      <Button size="sm" variant="ghost" onClick={() => void openFile(t.screenshotId!)}>
                        What it saw
                      </Button>
                    )}
                    {t.status === "failed" && (
                      <Button size="sm" variant="outline" onClick={() => void act({ op: "retry", taskId: t.id })}>
                        <RotateCw className="h-3.5 w-3.5" /> Try again
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {error && <p className="text-xs text-[var(--accent-danger)]">{error}</p>}
      </CardContent>
    </Card>
  );
}

function LoginForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ site: "", username: "", password: "", totp: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = "min-w-0 rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400";

  async function save() {
    setBusy(true);
    setError(null);
    const r = await portalAct({ op: "save_login", site: f.site, username: f.username, password: f.password, ...(f.totp.trim() ? { totp: f.totp } : {}) });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setF({ site: "", username: "", password: "", totp: "" });
    onDone();
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-xl bg-ink-50/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      autoComplete="off"
    >
      <input className={input} placeholder="Website, e.g. mycarrierpackets.com" aria-label="Website" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} />
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={input} placeholder="User name or email" aria-label="User name" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input className={input} type="password" placeholder="Password" aria-label="Password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </div>
      <input className={input} placeholder="2-step key (optional: the text code shown with the QR code)" aria-label="2-step key" autoComplete="off" value={f.totp} onChange={(e) => setF({ ...f, totp: e.target.value })} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" type="submit" disabled={busy || !f.site.trim() || !f.username.trim() || !f.password}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save login
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        {error && <span className="text-xs text-[var(--accent-danger)]">{error}</span>}
      </div>
    </form>
  );
}
