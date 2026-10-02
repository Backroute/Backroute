"use client";

import { useCallback, useEffect, useState } from "react";
import { Laptop, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { confirmTwoStep, listDevices, signOutOthers, startTwoStep, turnOffTwoStep, twoStepFactors, type Device, type TwoStepFactor } from "@/lib/cloud/security";
import { TimeAgo } from "@/components/shared/time-ago";

/** Two-step sign-in with an authenticator app, and every device this person is signed in on. */
export function SecurityCard() {
  const signedIn = useStore((s) => s.session.mode !== "demo");
  const [factors, setFactors] = useState<TwoStepFactor[] | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setFactors(await twoStepFactors().catch(() => []));
    setDevices(await listDevices().catch(() => []));
  }, [signedIn]);
  useEffect(() => {
    // What's set up, read once the card opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const on = factors?.find((f) => f.verified);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Sign-in and devices
          </CardTitle>
          <CardDescription>The account moves money and signs rate cons. Two-step sign-in means a stolen text code alone can&apos;t get in.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 !pt-3">
        {!signedIn ? (
          <p className="text-sm text-ink-500">In your own account: two-step sign-in with an authenticator app, the phones and computers you&apos;re signed in on, and signing the others out.</p>
        ) : (
          <>
            <section aria-labelledby="two-step" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p id="two-step" className="text-sm font-medium text-ink-950">
                    Two-step sign-in
                  </p>
                  <p className="text-xs text-ink-500">After the texted code, a code from an authenticator app (Google Authenticator, 1Password, Authy).</p>
                </div>
                {on ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
              </div>
              {on ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy("off");
                    const ok = await turnOffTwoStep(on.id);
                    setMsg(ok ? { ok: true, text: "Two-step sign-in is off." } : { ok: false, text: "Couldn't turn it off. Sign in again with the app's code first." });
                    setBusy(null);
                    await refresh();
                  }}
                >
                  Turn off
                </Button>
              ) : setup ? (
                <form
                  className="flex flex-col gap-3 rounded-2xl bg-ink-50 p-4"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy("confirm");
                    const ok = await confirmTwoStep(setup.factorId, code);
                    setBusy(null);
                    if (!ok) return setMsg({ ok: false, text: "That code didn't match. Use the newest one in the app." });
                    setSetup(null);
                    setCode("");
                    setMsg({ ok: true, text: "Two-step sign-in is on. You'll be asked for the app's code each time you sign in." });
                    await refresh();
                  }}
                >
                  <p className="text-sm text-ink-700">1. In the authenticator app, add an account and scan this.</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={setup.qr} alt="QR code for your authenticator app" width={176} height={176} className="h-44 w-44 rounded-xl bg-white p-2" />
                  <p className="text-xs text-ink-500">
                    Can&apos;t scan? Type this key: <span className="break-all font-mono text-ink-800">{setup.secret}</span>
                  </p>
                  <label className="text-sm text-ink-700">
                    2. Enter the 6-digit code it shows
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="mt-1.5 block w-40 rounded-full border border-line bg-white px-4 py-2 text-center tabular tracking-[0.3em] outline-none focus:border-ink-400"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" type="submit" disabled={code.length < 6 || !!busy}>
                      {busy === "confirm" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Turn on
                    </Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setSetup(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  size="sm"
                  className="self-start"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy("start");
                    setMsg(null);
                    try {
                      setSetup(await startTwoStep());
                    } catch {
                      setMsg({ ok: false, text: "Couldn't start it. Check your connection, or ask support if two-step isn't enabled for Backroute yet." });
                    }
                    setBusy(null);
                  }}
                >
                  {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Set up two-step sign-in
                </Button>
              )}
            </section>

            <section aria-labelledby="devices" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p id="devices" className="text-sm font-medium text-ink-950">
                  Where you&apos;re signed in
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy || !devices?.some((d) => !d.current)}
                  onClick={async () => {
                    setBusy("others");
                    const ok = await signOutOthers();
                    setMsg(ok ? { ok: true, text: "Signed out everywhere else. Those devices need the texted code to get back in." } : { ok: false, text: "Couldn't sign the others out. Try again." });
                    setBusy(null);
                    await refresh();
                  }}
                >
                  Sign out the others
                </Button>
              </div>
              <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
                {(devices ?? []).map((d) => {
                  const Icon = /iPhone|Android|iPad/.test(d.label) ? Smartphone : Laptop;
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="flex items-center gap-2.5 text-ink-900">
                        <Icon className="h-4 w-4 text-ink-400" /> {d.label}
                      </span>
                      <span className="text-xs text-ink-500">{d.current ? <Badge tone="info">This one</Badge> : <TimeAgo iso={d.lastSeenAt} />}</span>
                    </li>
                  );
                })}
                {devices && !devices.length && <li className="px-4 py-3 text-sm text-ink-500">Just this one.</li>}
              </ul>
            </section>
            {msg && <p className={`text-sm ${msg.ok ? "text-[var(--accent-live)]" : "text-[var(--accent-danger)]"}`}>{msg.text}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
