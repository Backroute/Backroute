"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { cloudEnabled, supabase } from "@/lib/cloud/client";
import { claimInvites, homeFor, myMemberships } from "@/lib/cloud/account";
import { formatPhone, toE164 } from "@/lib/cloud/phone";
import { leaveDemo } from "@/lib/cloud/demo";

/** Sign in with a phone number and a texted code: no passwords for drivers to forget. */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <section className="rounded-3xl border border-line bg-white p-6">
          {cloudEnabled ? (
            <Suspense fallback={<Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-400" />}>
              <PhoneSignIn />
            </Suspense>
          ) : (
            <DemoNotice />
          )}
        </section>
      </div>
    </div>
  );
}

function DemoNotice() {
  return (
    <>
      <h1 className="font-display text-2xl text-ink-950">Sign in</h1>
      <p className="mt-1 text-sm text-ink-500">Accounts aren&apos;t switched on in this demo yet, so there&apos;s nothing to sign in to. You can look around with the sample fleet.</p>
      <div className="mt-5 flex flex-col gap-2">
        <Button href="/demo">
          See the demo <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}

function PhoneSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [raw, setRaw] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Signing in is the real app: this tab stops being a demo tab.
  useEffect(() => leaveDemo(), []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const parsed = toE164(raw);

  async function sendCode(to: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithOtp({ phone: to });
    setBusy(false);
    if (error) return setError(error.status === 429 ? "Too many tries. Wait a minute and try again." : "Couldn't send the text. Check the number and try again.");
    setPhone(to);
    setStep("code");
    setCode("");
    setResendIn(30);
  }

  async function verify() {
    if (!phone || code.length < 6) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.verifyOtp({ phone, token: code, type: "sms" });
    if (error) {
      setBusy(false);
      return setError("That code didn't work. Check it, or send a new one.");
    }
    try {
      await claimInvites();
      const m = (await myMemberships())[0];
      const next = params.get("next");
      if (!m) return router.replace("/signup");
      const home = homeFor(m);
      // Back to the page they came from, if it's on their side of the app.
      router.replace(next && next.startsWith(home) ? next : home);
    } catch {
      setBusy(false);
      setError("Signed in, but couldn't load your account. Check your connection and try again.");
    }
  }

  if (step === "phone")
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) void sendCode(parsed);
        }}
      >
        <h1 className="font-display text-2xl text-ink-950">Sign in</h1>
        <p className="mt-1 text-sm text-ink-500">We&apos;ll text you a code. Drivers use the number the office added them with.</p>
        <label htmlFor="phone" className="mt-5 block text-xs font-medium text-ink-700">
          Phone number
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="(214) 555-0148"
          className="mt-1.5 w-full rounded-full border border-line px-4 py-2.5 text-base outline-none focus:border-ink-400"
        />
        {raw && !parsed && <p className="mt-2 text-xs text-ink-500">Enter a 10-digit number, or +country code for outside the US and Canada.</p>}
        {error && <p className="mt-3 text-sm text-[var(--accent-danger)]">{error}</p>}
        <Button type="submit" className="mt-5 w-full" disabled={!parsed || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Text me a code"}
        </Button>
        <p className="mt-5 text-center text-xs text-ink-500">
          New to Backroute?{" "}
          <Link href="/signup" className="font-medium text-ink-950 underline">
            Set up your fleet
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-ink-500">
          Just looking?{" "}
          <Link href="/demo" className="font-medium text-ink-950 underline">
            See the demo
          </Link>
        </p>
      </form>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      <h1 className="font-display text-2xl text-ink-950">Enter the code</h1>
      <p className="mt-1 text-sm text-ink-500">Sent to {phone ? formatPhone(phone) : "your phone"}.</p>
      <label htmlFor="code" className="sr-only">
        6-digit code
      </label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
        className="mt-5 w-full rounded-full border border-line px-4 py-2.5 text-center text-lg tracking-[0.4em] tabular outline-none focus:border-ink-400"
      />
      {error && <p className="mt-3 text-sm text-[var(--accent-danger)]">{error}</p>}
      <Button type="submit" className="mt-5 w-full" disabled={code.length < 6 || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </Button>
      <div className="mt-4 flex justify-between text-xs">
        <button type="button" className="text-ink-500 underline" onClick={() => setStep("phone")}>
          Different number
        </button>
        <button type="button" className="text-ink-500 underline disabled:no-underline disabled:opacity-60" disabled={resendIn > 0 || busy} onClick={() => phone && void sendCode(phone)}>
          {resendIn > 0 ? `Send again in ${resendIn}s` : "Send again"}
        </button>
      </div>
    </form>
  );
}
