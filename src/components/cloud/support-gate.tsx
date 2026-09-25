"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/ai/client";
import { supabase } from "@/lib/cloud/client";
import { signOut } from "@/lib/cloud/sync";
import { SupportConsole } from "./support-console";

/** /ops on the real site: Backroute's support console, only for people on the support team list. */
export function SupportGate() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "yes" | "no">("checking");
  useEffect(() => {
    (async () => {
      const { data } = await supabase().auth.getSession();
      if (!data.session) return router.replace("/login?next=/ops");
      const res = await fetch("/api/support/me", { headers: await authHeader() }).catch(() => null);
      const me = (await res?.json().catch(() => null)) as { support?: boolean } | null;
      setState(me?.support ? "yes" : "no");
    })();
  }, [router]);

  if (state === "yes") return <SupportConsole />;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-50 px-6 text-center">
      <Logo />
      {state === "checking" ? (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking
        </p>
      ) : (
        <>
          <p className="max-w-xs text-sm text-ink-700">This page is for Backroute&apos;s support team.</p>
          <div className="flex gap-2">
            <Button href="/carrier">Go to my dashboard</Button>
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
