"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/shared/time-ago";
import { authHeader } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

export interface EmailSetupStatus {
  lastTest: { at: string; from: string | null; via: "direct" | "forward" | "gmail" | "outlook" } | null;
  gmailCode: { at: string; code: string | null; link: string | null } | null;
}

interface Mailbox {
  available: { gmail: boolean; outlook: boolean };
  connected: { kind: "gmail" | "outlook"; email: string; status: string | null; lastChecked: string | null; taken: number } | null;
}

type Provider = "gmail" | "outlook" | "other";
const NAME = { gmail: "Gmail", outlook: "Outlook" } as const;

const RESULT: Record<string, string> = {
  connected: "Connected. Broker mail in your inbox now reaches Backroute within a few minutes.",
  cancelled: "Not connected: the sign-in page was closed before it finished.",
  expired: "That took too long. Start again.",
  failed: "That mailbox didn't let us in. Try again.",
  off: "Connecting a mailbox isn't available yet. Use forwarding below.",
};

/**
 * Getting broker mail to Backroute, step by step, with a live check at the end. Brokers already have the owner's
 * usual address (it's on every setup packet), so the AI only sees a rate con first if that mail comes here: by
 * connecting the mailbox (Gmail or Outlook, read-only, broker mail only), or by forwarding to the Backroute address.
 * The test: an email with "Backroute test" in the subject, sent to the usual address, should show up here.
 */
export function EmailSetup({ address, setup, onRefresh }: { address: string; setup: EmailSetupStatus | null; onRefresh: () => Promise<void> | void }) {
  const [provider, setProvider] = useState<Provider>("gmail");
  const [copied, setCopied] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [testFrom, setTestFrom] = useState<number | null>(null);

  const loadMailbox = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/mailbox", { headers: await authHeader() });
      if (res.ok) setMailbox((await res.json()) as Mailbox);
    } catch {
      // Offline: shows forwarding only until the next try.
    }
  }, []);
  useEffect(() => {
    // Back from Google's or Microsoft's page: say how it went.
    const r = new URLSearchParams(window.location.search).get("mailbox");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (r && RESULT[r]) setNote(RESULT[r]);
    void loadMailbox();
  }, [loadMailbox]);

  // While a test is running, look every 5 seconds instead of every 30.
  const passed = !!(testFrom && setup?.lastTest && Date.parse(setup.lastTest.at) >= testFrom - 5000);
  useEffect(() => {
    if (!testFrom || passed) return;
    const id = setInterval(() => void onRefresh(), 5000);
    const stop = setTimeout(() => clearInterval(id), 10 * 60_000);
    return () => (clearInterval(id), clearTimeout(stop));
  }, [testFrom, passed, onRefresh]);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  async function connect(kind: "gmail" | "outlook") {
    setBusy(true);
    const res = await fetch(`/api/integrations/mailbox?kind=${kind}`, { method: "POST", headers: await authHeader() }).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { url?: string }) : null;
    if (body?.url) window.location.assign(body.url);
    else {
      setNote(res?.status === 401 ? "Only the owner can connect the mailbox." : "Couldn't start. Check your connection and try again.");
      setBusy(false);
    }
  }
  async function disconnect(kind: "gmail" | "outlook") {
    setBusy(true);
    await fetch(`/api/integrations/mailbox?kind=${kind}`, { method: "DELETE", headers: await authHeader() }).catch(() => null);
    setNote(`Disconnected. Backroute no longer reads ${NAME[kind]}.`);
    setBusy(false);
    void loadMailbox();
  }

  const connected = mailbox?.connected;
  const canConnect = provider !== "other" && !!mailbox?.available[provider];
  const step = "flex gap-3";
  const num = (n: number, done?: boolean) => (
    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-[var(--accent-live)] text-white" : "bg-ink-950 text-white")}>{done ? <Check className="h-3.5 w-3.5" /> : n}</span>
  );

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line p-4" aria-label="Broker email setup">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
          <Mail className="h-4 w-4 text-ink-400" /> Get rate cons to Backroute first
        </p>
        <p className="mt-1 text-xs text-ink-500">Brokers email the address on your setup papers. Send that mail here too, and Backroute reads each rate con the minute it lands.</p>
      </div>
      {note && (
        <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-700" role="status">
          {note}
        </p>
      )}

      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
          <div className="min-w-0 text-xs">
            <p className="font-medium text-ink-900">
              <Check className="mr-1 inline h-3.5 w-3.5 text-[var(--accent-live)]" />
              {NAME[connected.kind]} connected: {connected.email}
            </p>
            <p className="mt-0.5 text-ink-500">
              {connected.status ?? "Reading broker mail"}
              {connected.lastChecked && (
                <>
                  {" "}· checked <TimeAgo iso={connected.lastChecked} />
                </>
              )}
            </p>
          </div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect(connected.kind)}>
            Disconnect
          </Button>
        </div>
      ) : (
        <>
          <div className={step}>
            {num(1)}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">Where do brokers email you now?</p>
              <div className="mt-2 flex gap-1.5" role="group" aria-label="Your email">
                {(["gmail", "outlook", "other"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={provider === p}
                    onClick={() => setProvider(p)}
                    className={cn("rounded-full px-3 py-1.5 text-xs font-medium", provider === p ? "bg-ink-950 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-150")}
                  >
                    {p === "gmail" ? "Gmail" : p === "outlook" ? "Outlook / Microsoft 365" : "Something else"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={step}>
            {num(2)}
            <div className="min-w-0 flex-1 text-xs text-ink-600">
              {canConnect ? (
                <>
                  <p className="text-sm font-medium text-ink-900">Connect {NAME[provider]}</p>
                  <p className="mt-1">Backroute reads only broker mail (rate cons, tenders, BOLs, payments, mail from your brokers). It never sends from your mailbox or changes anything in it.</p>
                  <Button size="sm" className="mt-2" disabled={busy} onClick={() => void connect(provider)}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Connect {NAME[provider]}
                  </Button>
                  <p className="mt-2 text-ink-400">Rather not? Forward instead:</p>
                </>
              ) : (
                <p className="text-sm font-medium text-ink-900">Forward it to your Backroute address</p>
              )}
              <button type="button" onClick={() => copy(address)} className="mt-2 flex max-w-full items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 font-medium text-ink-950">
                {copied === address ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{address}</span>
              </button>
              <ForwardSteps provider={provider} code={setup?.gmailCode ?? null} onCopy={copy} copied={copied} />
            </div>
          </div>
        </>
      )}

      <div className={step}>
        {num(connected ? 1 : 3, passed)}
        <div className="min-w-0 flex-1 text-xs text-ink-600">
          <p className="text-sm font-medium text-ink-900">Test it</p>
          {passed && setup?.lastTest ? (
            <p className="mt-1 text-[var(--accent-live)]" role="status">
              Got it <TimeAgo iso={setup.lastTest.at} />
              {setup.lastTest.from ? ` from ${setup.lastTest.from}` : ""}.{" "}
              {setup.lastTest.via === "direct" ? (
                <span className="text-[var(--accent-warn)]">But it was sent straight to the Backroute address, so forwarding isn&apos;t tested. Send it to your usual address.</span>
              ) : (
                "Broker mail to your usual address reaches Backroute."
              )}
            </p>
          ) : testFrom ? (
            <p className="mt-1 flex items-center gap-1.5" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for your email… It usually takes under a minute{connected ? " (up to 5 with a connected mailbox)" : ""}.
            </p>
          ) : (
            <p className="mt-1">From any email, send a message to your usual address with <b className="text-ink-900">Backroute test</b> in the subject.</p>
          )}
          {!passed && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => (setTestFrom(Date.now()), void onRefresh())}>
              {testFrom ? "Check again" : "I sent it"}
            </Button>
          )}
          {!testFrom && setup?.lastTest && (
            <p className="mt-2 text-ink-400">
              Last test arrived <TimeAgo iso={setup.lastTest.at} />.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ForwardSteps({ provider, code, onCopy, copied }: { provider: Provider; code: EmailSetupStatus["gmailCode"]; onCopy: (t: string) => void; copied: string | null }) {
  if (provider === "gmail")
    return (
      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>On a computer, open Gmail → the gear → See all settings → Forwarding and POP/IMAP.</li>
        <li>Add a forwarding address, paste the address above, then Next → Proceed.</li>
        <li>
          Google sends a code to Backroute. It shows here:{" "}
          {code?.code ? (
            <button type="button" onClick={() => onCopy(code.code!)} className="inline-flex items-center gap-1 rounded bg-ink-950 px-1.5 py-0.5 font-mono font-semibold text-white">
              {code.code} {copied === code.code ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          ) : (
            <span className="text-ink-400">waiting for Google…</span>
          )}
          {code?.link && (
            <>
              {" "}
              or{" "}
              <a href={code.link} target="_blank" rel="noreferrer" className="font-medium text-ink-950 underline">
                confirm it here
              </a>
            </>
          )}
        </li>
        <li>Type the code into Gmail and Verify.</li>
        <li>Pick &quot;Forward a copy of incoming mail to&quot; this address and &quot;keep Gmail&apos;s copy in the Inbox&quot;. Save.</li>
      </ol>
    );
  if (provider === "outlook")
    return (
      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>In Outlook on the web: Settings → Mail → Forwarding.</li>
        <li>Turn on forwarding, paste the address above, and tick &quot;Keep a copy of forwarded messages&quot;. Save.</li>
        <li>On a work Microsoft 365 account, your admin may block forwarding outside the company. If the test below never arrives, ask them to allow it for this address, or connect Outlook.</li>
      </ol>
    );
  return (
    <ol className="mt-2 list-decimal space-y-1 pl-4">
      <li>In your email&apos;s settings, find Forwarding (sometimes under Rules or Filters).</li>
      <li>Forward all incoming mail to the address above, and keep a copy in your inbox.</li>
      <li>No forwarding? Ask your brokers to copy this address on rate cons, or send it to them as your dispatch email.</li>
    </ol>
  );
}
