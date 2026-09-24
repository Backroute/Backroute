"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, LogOut, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { invite, team, type Role } from "@/lib/cloud/account";
import { formatPhone, toE164 } from "@/lib/cloud/phone";
import { signOut } from "@/lib/cloud/sync";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Team = Awaited<ReturnType<typeof team>>;

/**
 * Who can sign in to this fleet. Drivers sign in with the phone number on their profile; the owner lets each one in
 * with a tap. Backroute doesn't text them the link yet, so the card says what to send.
 */
export function AppAccessCard() {
  const carrierId = useStore((s) => s.session.carrierId);
  const drivers = useStore((s) => s.drivers);
  const [data, setData] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!carrierId) return;
    try {
      setData(await team(carrierId));
    } catch {
      setError("Couldn't load who has access. Check your connection.");
    }
  }, [carrierId]);

  useEffect(() => {
    // Loading the team is an effect of opening the card; the state it sets comes back from the network.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function letIn(key: string, rawPhone: string, role: Role, driverId: string | null) {
    const e164 = toE164(rawPhone);
    if (!carrierId || !e164) return setError("That phone number doesn't look right. Fix it on the driver's profile first.");
    setBusy(key);
    setError(null);
    try {
      await invite(carrierId, e164, role, driverId);
      await refresh();
      if (role === "dispatcher") setPhone("");
    } catch {
      setError("Only the owner can add people. If that's you, check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!carrierId) return null;
  const loginUrl = typeof window === "undefined" ? "/login" : `${window.location.origin}/login`;
  const statusOf = (driverId: string) =>
    data?.members.some((m) => m.driver_id === driverId) ? "in" : data?.invites.some((i) => i.driver_id === driverId) ? "invited" : "none";
  const dispatchers = data?.members.filter((m) => m.role === "dispatcher").length ?? 0;
  const pendingDispatchers = data?.invites.filter((i) => i.role === "dispatcher") ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who can sign in</CardTitle>
        <CardDescription>Drivers see only their own loads, calls and pay. Dispatchers see everything you do.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-4">
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
          {drivers.map((d) => {
            const status = statusOf(d.id);
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={d.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{d.name}</p>
                    <p className="truncate text-xs text-ink-500">{d.phone}</p>
                  </div>
                </div>
                {status === "in" ? (
                  <Badge tone="dark">Signed in</Badge>
                ) : status === "invited" ? (
                  <Badge tone="neutral">Can sign in</Badge>
                ) : (
                  <Button size="sm" variant="outline" disabled={!data || busy === d.id} onClick={() => letIn(d.id, d.phone, "driver", d.id)}>
                    Let them sign in
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="rounded-2xl bg-ink-50 px-4 py-3 text-xs text-ink-600">
          <p>Send your drivers this link. They sign in with the phone number shown above.</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(loginUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="mt-1.5 flex items-center gap-1.5 font-medium text-ink-950"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {loginUrl}
          </button>
        </div>

        <div>
          <p className="text-xs font-medium text-ink-700">
            Dispatchers{dispatchers ? ` · ${dispatchers} signed in` : ""}
            {pendingDispatchers.length ? ` · ${pendingDispatchers.map((i) => formatPhone(i.phone)).join(", ")} can sign in` : ""}
          </p>
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void letIn("dispatcher", phone, "dispatcher", null);
            }}
          >
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Dispatcher's phone number"
              aria-label="Dispatcher's phone number"
              className="min-w-0 flex-1 rounded-full border border-line bg-ink-50/60 px-4 py-2 text-sm outline-none focus:border-ink-400"
            />
            <Button size="sm" type="submit" disabled={!toE164(phone) || busy === "dispatcher"}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </form>
        </div>

        {error && <p className="text-sm text-[var(--accent-danger)]">{error}</p>}
        <SignOutButton label="Sign out" className="self-start" />
      </CardContent>
    </Card>
  );
}

/** Only shows when signed in to a real account. */
export function SignOutButton({ label, className }: { label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const signedIn = useStore((s) => s.session.mode !== "demo");
  if (!signedIn) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut();
      }}
      className={cn("flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm font-medium text-ink-700", className)}
    >
      <LogOut className="h-4 w-4" /> {label}
    </button>
  );
}
