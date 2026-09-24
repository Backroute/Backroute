"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CloudOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { cloudEnabled, supabase } from "@/lib/cloud/client";
import { claimInvites, homeFor, myMemberships } from "@/lib/cloud/account";
import { connect, NotSetUpError, signOut, useSyncStatus } from "@/lib/cloud/sync";
import { inDemo } from "@/lib/cloud/demo";
import { DemoBanner } from "./demo-banner";
import { useStore } from "@/lib/store";

type Area = "carrier" | "driver" | "signup";

/**
 * Real accounts, when they're switched on: sends signed-out visitors to /login, sends each person to the side of
 * the app that's theirs, and loads their carrier before showing anything. A tab opened from /demo skips all of it
 * and shows the sample fleet. With no Supabase keys everything is the demo.
 */
export function CloudGate({ area, children }: { area: Area; children: React.ReactNode }) {
  if (!cloudEnabled)
    return (
      <>
        <DemoBanner />
        {children}
      </>
    );
  return <LiveGate area={area}>{children}</LiveGate>;
}

function LiveGate({ area, children }: { area: Area; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "demo" | "ready" | "not_set_up" | "error">("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (inDemo()) return setState("demo");
      const { data } = await supabase().auth.getSession();
      if (!data.session) return router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      await claimInvites();
      const memberships = await myMemberships();
      const m = memberships[0];
      if (!m) return area === "signup" ? !cancelled && setState("ready") : router.replace("/signup");
      if (area === "signup" && useStore.getState().session.mode === "demo") return router.replace(homeFor(m));
      if (area === "carrier" && m.role === "driver") return router.replace("/driver");
      if (area === "driver" && m.role !== "driver" && !m.driverId) return router.replace("/carrier");
      if (area !== "signup") await connect(m);
      if (!cancelled) setState("ready");
    })().catch((e) => {
      if (!cancelled) setState(e instanceof NotSetUpError ? "not_set_up" : "error");
    });
    const { data: sub } = supabase().auth.onAuthStateChange((event) => {
      // A full page load, so the next person on this device doesn't inherit what's in memory.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (event === "SIGNED_OUT") window.location.assign("/login");
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // Checked once per area; the pathname only matters for coming back after sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, attempt]);

  if (state === "demo")
    return (
      <>
        <DemoBanner />
        {children}
      </>
    );
  if (state === "ready")
    return (
      <>
        {children}
        <OfflineNotice />
      </>
    );
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-50 px-6 text-center">
      <Logo />
      {state === "checking" && (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your fleet
        </p>
      )}
      {state === "not_set_up" && (
        <>
          <p className="max-w-xs text-sm text-ink-700">Your fleet isn&apos;t set up in Backroute yet. Ask whoever runs your trucks to open their dashboard once, then try again.</p>
          <div className="flex gap-2">
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </>
      )}
      {state === "error" && (
        <>
          <p className="max-w-xs text-sm text-ink-700">Couldn&apos;t load your fleet. Check your connection and try again.</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        </>
      )}
    </div>
  );
}

/** Only shows when saving is failing, so nobody thinks a change was saved when it wasn't. */
function OfflineNotice() {
  const state = useSyncStatus((s) => s.state);
  if (state !== "offline") return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 sm:bottom-6">
      <p className="flex items-center gap-2 rounded-full bg-ink-950 px-4 py-2 text-xs text-white shadow-lg">
        <CloudOff className="h-3.5 w-3.5" /> Not saved yet. Trying again when you&apos;re back online.
      </p>
    </div>
  );
}
